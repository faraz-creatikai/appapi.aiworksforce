import { SubtaskGenerationAgent, SubTaskVerificationAgent, TaskGenerationAgent, TaskMacroReviewAgent } from "../ai/agent.js";
import prisma from "../config/prismaClient.js";
import { notifyCustomerStepChanged, notifyCustomerTaskAssigned } from "../jobs/notification/notificationEvents.js";
import ApiError from "../utils/ApiError.js";
import { getCustomerAccessFilter } from "./controller.customer.js"; // RESTORED IMPORT

// ==================================================================
// 🏢 ADMIN CONTROLLERS (For CRM Portal)
// ==================================================================
export const createAdminTask = async (req, res, next) => {
  try {
    const adminId = req.admin.id || req.admin._id;
    const { title, description, priority, dueDate, assignedToIds, subTasks } = req.body;

    if (!title || !assignedToIds || !Array.isArray(assignedToIds) || assignedToIds.length === 0) {
      throw new ApiError(400, "Title and at least one Assigned Employee are required");
    }

    const validSubTasks = subTasks && Array.isArray(subTasks)
      ? subTasks.filter(st => st.title && st.title.trim() !== "")
      : [];

    const taskPromises = assignedToIds.map(empId => {
      const taskData = {
        title, description, priority: priority || "medium",
        dueDate: dueDate ? new Date(dueDate) : null,
        assignedToId: empId,
        createdById: adminId,
      };

      if (validSubTasks.length > 0) {
        taskData.subTasks = {
          create: validSubTasks.map((st) => ({
            title: st.title,
            description: st.description || null,
            createdById: empId,
            status: "todo"
          })),
        };
      }

      return prisma.task.create({
        data: taskData,
        include: {
          assignedTo: { select: { employeeName: true, Email: true } }, // Updated field
          subTasks: true
        }
      });
    });

    const newTasks = await prisma.$transaction(taskPromises);
    res.status(201).json({ success: true, message: `Task assigned successfully`, data: newTasks });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};


export const getAdminTasks = async (req, res, next) => {
  try {
    // 🚨 ADDED: customerId filter
    const { search, status, priority, date, exactDate, employeeId, customerId, limit = 100, skip = 0 } = req.query;
    let AND = [];

    if (search) AND.push({ title: { contains: search.trim() } });
    if (priority && priority !== 'all') AND.push({ priority });
    if (employeeId && employeeId !== 'all') AND.push({ assignedToId: employeeId });
    if (customerId && customerId !== 'all') AND.push({ customerId: customerId }); // 🚨 Filter by Client

    if (status && status !== 'all') {
      if (status === 'completed') AND.push({ subTasks: { some: {}, every: { status: 'completed' } } });
      else AND.push({ subTasks: { some: { status } } });
    }

    if (exactDate) {
      const startOfDay = new Date(exactDate); startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(exactDate); endOfDay.setHours(23, 59, 59, 999);
      AND.push({ dueDate: { gte: startOfDay, lte: endOfDay } });
    } else if (date && date !== 'all') {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

      if (date === 'today') AND.push({ dueDate: { gte: todayStart, lte: todayEnd } });
      else if (date === 'overdue') {
        AND.push({ dueDate: { lt: todayStart } });
        AND.push({ OR: [{ subTasks: { some: { status: { not: 'completed' } } } }, { subTasks: { none: {} } }] });
      } else if (date === 'upcoming') AND.push({ dueDate: { gt: todayEnd } });
    }

    const tasks = await prisma.task.findMany({
      where: AND.length > 0 ? { AND } : {},
      include: {
        assignedTo: { select: { employeeName: true, Email: true, ContactNumber: true, id: true } },
        customer: { select: { customerName: true, id: true } }, // 🚨 Included Client context
        subTasks: { orderBy: { createdAt: 'asc' } },
        _count: { select: { subTasks: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit), skip: Number(skip)
    });

    res.status(200).json({ success: true, count: tasks.length, data: tasks });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ... updateAdminTask, deleteAdminTask, getEmployeeTasks, updateEmployeeTaskStatus, createSubTask, updateSubTaskStatus, toggleSubTask, and deleteSubTask remain exactly the same logically, as they just update `prisma.task` and `prisma.subTask`.

export const updateAdminTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    // 🚨 MODIFIED: Now accepts assignedToIds (Array)
    const { title, description, priority, dueDate, assignedToIds, customerId } = req.body;

    if (!assignedToIds || !Array.isArray(assignedToIds) || assignedToIds.length === 0) {
      return next(new ApiError(400, "At least one assignedToId is required"));
    }

    const primaryEmpId = assignedToIds[0];

    const existing = await prisma.task.findUnique({ where: { id }, select: { customerId: true, assignedToId: true } });
if (!existing) return next(new ApiError(404, "Task not found"));

    // 1. Update the original Task with the First Employee
    const updatedTask = await prisma.task.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(priority && { priority }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        assignedToId: primaryEmpId,
        ...(customerId !== undefined && { customerId }) 
      },
      include: { subTasks: true } // Need subtasks in case we clone
    });

    const newlyLinked = updatedTask.customerId && (existing.customerId !== updatedTask.customerId || existing.assignedToId !== primaryEmpId);
if (newlyLinked) notifyCustomerTaskAssigned(updatedTask.id);

    // Add primary employee to client's team
    if (customerId && primaryEmpId) {
       await prisma.customer.update({
        where: { id: customerId },
        data: { assignedTeam: { connect: { id: primaryEmpId } } }
      });
    }

    // 2. 🚨 CLONING ENGINE: If more employees were selected, duplicate the task for them
    if (assignedToIds.length > 1) {
       const adminId = req.admin.id || req.admin._id;
       const extraEmps = assignedToIds.slice(1);
       
       const newTasksPromises = extraEmps.map(empId => {
         return prisma.task.create({
           data: {
             title: updatedTask.title,
             description: updatedTask.description,
             priority: updatedTask.priority,
             dueDate: updatedTask.dueDate,
             customerId: updatedTask.customerId,
             assignedToId: empId,
             createdById: adminId,
             subTasks: {
               create: updatedTask.subTasks.map(st => ({
                 title: st.title,
                 description: st.description,
                 createdById: empId,
                 status: "todo"
               }))
             }
           }
         });
       });

       const clonedTasks = await prisma.$transaction(newTasksPromises);
clonedTasks.forEach((t) => t.customerId && notifyCustomerTaskAssigned(t.id));

       // Add extra employees to the client's team
       if (customerId) {
         await prisma.customer.update({
           where: { id: customerId },
           data: { assignedTeam: { connect: extraEmps.map(empId => ({ id: empId })) } }
         });
       }
    }

    res.status(200).json({ success: true, message: "Task updated and assigned", data: updatedTask });
  } catch (error) {
    if (error.code === "P2025") return next(new ApiError(404, "Task not found"));
    next(new ApiError(500, error.message));
  }
};

export const deleteAdminTask = async (req, res, next) => {
  try {
    const { taskIds } = req.body;
    if (!taskIds || taskIds.length === 0) {
      throw new ApiError(400, "Please provide an array of taskIds to delete");
    }

    await prisma.task.deleteMany({
      where: { id: { in: taskIds } },
    });

    res.status(200).json({ success: true, message: "Tasks deleted successfully" });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ==================================================================
// 🧑‍💻 EMPLOYEE CONTROLLERS (For Staff Workspace)
// ==================================================================

export const getEmployeeTasks = async (req, res, next) => {
  try {
    const employeeId = req.employee.id;
    // 🚨 ADDED: customerId to allow employees to filter by Project
    const { search, status, priority, date, exactDate, customerId, limit = 100, skip = 0 } = req.query;

    let AND = [{ assignedToId: employeeId }];

    if (customerId && customerId !== 'all') AND.push({ customerId: customerId }); // 🚨 Filter

    if (search) {
      AND.push({
        OR: [
          { title: { contains: search.trim() } },
          { description: { contains: search.trim() } }
        ]
      });
    }

    if (priority && priority !== 'all') AND.push({ priority });

    if (status && status !== 'all') {
      if (status === 'completed') {
        AND.push({ subTasks: { some: {}, every: { status: 'completed' } } });
      } else {
        AND.push({ subTasks: { some: { status } } });
      }
    }

    if (exactDate) {
      const startOfDay = new Date(exactDate); startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(exactDate); endOfDay.setHours(23, 59, 59, 999);
      AND.push({ dueDate: { gte: startOfDay, lte: endOfDay } });
    } else if (date && date !== 'all') {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

      if (date === 'today') AND.push({ dueDate: { gte: todayStart, lte: todayEnd } });
      else if (date === 'overdue') {
        AND.push({ dueDate: { lt: todayStart } });
        AND.push({
          OR: [
            { subTasks: { some: { status: { not: 'completed' } } } },
            { subTasks: { none: {} } }
          ]
        });
      } else if (date === 'upcoming') AND.push({ dueDate: { gt: todayEnd } });
    }

    const tasks = await prisma.task.findMany({
      where: { AND },
      include: {
        createdBy: { select: { name: true, role: true } },
        customer: { select: { customerName: true, id: true } }, // 🚨 Tell the employee which client this is for!
        subTasks: { orderBy: { createdAt: 'asc' } }
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: Number(skip)
    });

    const formattedTasks = tasks.map(t => ({
      ...t,
      createdBy: {
        name: t.createdBy?.name || "Admin",
        role: t.createdBy?.role || "Admin"
      }
    }));

    res.status(200).json({ success: true, count: formattedTasks.length, data: formattedTasks });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// RESTORED: Acts as a bridge for the UI until you update it.
// If the UI sends a task status update, we apply it to ALL subtasks of that task.
export const updateEmployeeTaskStatus = async (req, res, next) => {
  try {
    const employeeId = req.employee.id;
    const { id } = req.params; // Parent Task ID
    const { status } = req.body;

    // Update all subtasks belonging to this task
 const changing = await prisma.subTask.findMany({
  where: { taskId: id, createdById: employeeId, status: { not: status } },
  select: { id: true }
});

await prisma.subTask.updateMany({
  where: { taskId: id, createdById: employeeId },
  data: { status }
});

changing.forEach((s) => notifyCustomerStepChanged(s.id));


// ← add: notify each affected step
const steps = await prisma.subTask.findMany({
  where: { taskId: id, createdById: employeeId },
  select: { id: true }
});
steps.forEach((s) => notifyCustomerStepChanged(s.id));

    res.status(200).json({ success: true, message: "Task status applied to subtasks" });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};



// --- SUBTASK CONTROLLERS ---

export const createSubTask = async (req, res, next) => {
  try {
    const employeeId = req.employee.id;
    const { taskId, title, description } = req.body;

    if (!title || !taskId) throw new ApiError(400, "Task ID and Title are required");

    const parentTask = await prisma.task.findFirst({
      where: { id: taskId, assignedToId: employeeId }
    });

    if (!parentTask) throw new ApiError(404, "Parent task not found or access denied");

    const newSubTask = await prisma.subTask.create({
      data: {
        title,
        description: description || null,
        taskId,
        createdById: employeeId,
        status: "todo"
      }
    });

    res.status(201).json({ success: true, data: newSubTask });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

// ---------------------------------------------
// UPDATE INDIVIDUAL SUBTASK STATUS
// ---------------------------------------------
export const updateSubTaskStatus = async (req, res, next) => {
  try {
    const employeeId = req.employee.id;
    const { id } = req.params; // This is the SubTask ID
    const { status } = req.body; // Expects TaskStatus enum ('todo', 'in_progress', 'completed', etc.)

    // 1. Verify the subtask belongs to this employee
    const subTask = await prisma.subTask.findFirst({
      where: { id, task: { assignedToId: employeeId } } 
    });

    if (!subTask) {
      throw new ApiError(404, "Subtask not found or access denied");
    }

    // 2. Update just this specific subtask
    const updated = await prisma.subTask.update({
      where: { id },
      data: { status }
    });
if (status !== subTask.status) notifyCustomerStepChanged(updated.id); 
    res.status(200).json({ success: true, data: updated, message: "Subtask status updated" });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

// RESTORED: Acts as a bridge for the UI until you update it.
// Translates `isCompleted` boolean into new Enum status.
export const toggleSubTask = async (req, res, next) => {
  try {
    const employeeId = req.employee.id;
    const { id } = req.params;
    const { isCompleted } = req.body; // Old UI sends boolean

    // Map boolean to new enum
    const newStatus = isCompleted ? 'completed' : 'todo';

    const updated = await prisma.subTask.updateMany({
     where: { id, task: { assignedToId: employeeId } }, 
      data: { status: newStatus }
    });

    if (updated.count === 0) throw new ApiError(404, "Subtask not found");
    notifyCustomerStepChanged(id);

    res.status(200).json({ success: true, message: "Subtask updated" });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

export const deleteSubTask = async (req, res, next) => {
  try {
    const employeeId = req.employee.id;
    const { id } = req.params;

    const deleted = await prisma.subTask.deleteMany({
      where: { id, task: { assignedToId: employeeId } }
    });

    if (deleted.count === 0) throw new ApiError(404, "Subtask not found");

    res.status(200).json({ success: true, message: "Subtask removed" });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

// ==================================================================
// 🤖 AI WORKSPACE CONTROLLERS
// ==================================================================
export const generateSubtasksAI = async (req, res, next) => {
  try {
    // 🚨 ADDED: customerId context for AI
    const { title, description, assignedToId, customerId } = req.body;
    if (!title) throw new ApiError(400, "Task title is required to generate subtasks");

    let employeeContext = {};
    if (assignedToId) {
      const employee = await prisma.employee.findUnique({
        where: { id: assignedToId },
        select: { employeeName: true, Department: true, Designation: true, Description: true }
      });
      if (employee) employeeContext = employee;
    }

    // 🚨 Fetch Client Context if attached
    let clientContext = {};
    if (customerId) {
      const client = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { customerName: true, CustomerFields: true, Description: true }
      });
      if (client) clientContext = client;
    }

    // Pass both contexts to the agent (requires minor tweak in SubtaskGenerationAgent arguments later)
    const generatedSubtasks = await SubtaskGenerationAgent(title, description, employeeContext, clientContext);
    res.status(200).json({ success: true, message: "Subtasks generated successfully", data: generatedSubtasks });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

export const assignTaskViaAI = async (req, res, next) => {
  try {
    // 🚨 ADDED: customerId
    const { prompt, assignedToIds, customerId } = req.body;
    const adminId = req.admin.id || req.admin._id;

    if (!prompt || !assignedToIds || !Array.isArray(assignedToIds) || assignedToIds.length === 0) {
      throw new ApiError(400, "Prompt and at least one Employee ID are required");
    }

    const employeesList = await prisma.employee.findMany({
      where: { id: { in: assignedToIds } },
      select: { id: true, employeeName: true, Email: true, Department: true, Designation: true }
    });

    if (employeesList.length === 0) throw new ApiError(404, "Employees not found");

    let clientContext = {};
    if (customerId) {
      const client = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { customerName: true, CustomerFields: true }
      });
      if (client) clientContext = client;
    }

    // Generates the task contextually based on the team and the client
    const aiTaskData = await TaskGenerationAgent(prompt, employeesList, clientContext);

    const taskPromises = assignedToIds.map(empId => {
      return prisma.task.create({
        data: {
          title: aiTaskData.title,
          description: aiTaskData.description,
          priority: aiTaskData.priority || "medium",
          assignedToId: empId,
          createdById: adminId,
          customerId: customerId || null, // 🚨 Link to client
          subTasks: {
            create: aiTaskData.subTasks.map(st => ({
              title: st.title, description: st.description, createdById: empId, status: "todo"
            }))
          }
        },
        include: { subTasks: true }
      });
    });

    const newTasks = await prisma.$transaction(taskPromises);
    
    // 🚨 Auto-add these employees to the client's assigned team
    if (customerId) {
      await prisma.customer.update({
        where: { id: customerId },
        data: { assignedTeam: { connect: assignedToIds.map(id => ({ id })) } }
      });

       newTasks.forEach((t) => notifyCustomerTaskAssigned(t.id)); 
    }

    res.status(201).json({ success: true, message: `Assigned tasks to ${newTasks.length} employees!`, data: newTasks, aiSummary: aiTaskData.executionSummary });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};




// ---------------------------------------------------------
// MICRO-QA CONTROLLER: Verify a specific step
// ---------------------------------------------------------

export const verifySubTask = async (req, res, next) => {
  try {
    // FIXED: Extract 'id' to match the route definition '/employee/subtask/:id/verify'
    const { id } = req.params; 
    const { submittedProof } = req.body;

    if (!submittedProof || submittedProof.trim() === "") {
      return next(new ApiError(400, "Submitted proof is required"));
    }

    // FIXED: Use 'id' here
    const subTask = await prisma.subTask.findUnique({ where: { id } });
    if (!subTask) return next(new ApiError(404, "SubTask not found"));

    // 1. Gather System Context (The Automated Investigator)
    let systemCheck = "No automated system check performed.";
    
    // Quick automated ping if the proof contains a URL
    const urlMatch = submittedProof.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); 
        
        const check = await fetch(urlMatch[0], { method: 'HEAD', signal: controller.signal });
        clearTimeout(timeoutId);
        
        systemCheck = `System pinged URL (${urlMatch[0]}). Returned HTTP Status: ${check.status}`;
      } catch (e) {
        systemCheck = `System pinged URL (${urlMatch[0]}). Failed to resolve or timed out.`;
      }
    }

    // 2. Call the Micro-QA Agent
    const aiJudgment = await SubTaskVerificationAgent(subTask, submittedProof, systemCheck);

    // 3. Update the Database
    // FIXED: Use 'id' here
    const updatedSubTask = await prisma.subTask.update({
      where: { id },
      data: {
        submittedProof: submittedProof,
        isAiVerified: aiJudgment.isVerified,
        isCompleted: aiJudgment.isVerified, // Auto-complete if verified
      /*     ...(aiJudgment.isVerified && { status: "completed" }), */
        aiFeedback: aiJudgment.isVerified ? null : aiJudgment.feedback
      }
    });

   /*  if (aiJudgment.isVerified) notifyCustomerStepChanged(id); */ // ← add

    res.status(200).json({ 
      success: true, 
      message: aiJudgment.isVerified ? "Step verified!" : "Step rejected.",
      data: updatedSubTask 
    });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------------
// MACRO-QA CONTROLLER: Final Task Submission
// ---------------------------------------------------------
export const submitTaskForMacroReview = async (req, res, next) => {
  try {
    const { taskId } = req.params;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { 
        subTasks: true,
        reviewLogs: true 
      }
    });

    if (!task) return next(new ApiError(404, "Task not found"));

    // 1. Hard Blocker: Ensure all subtasks are verified
    const unverifiedSubtasks = task.subTasks.filter(st => !st.isAiVerified);
    if (unverifiedSubtasks.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot submit. ${unverifiedSubtasks.length} step(s) still require AI verification.` 
      });
    }

    // 2. Call the Macro-QA Agent
    const aiJudgment = await TaskMacroReviewAgent(task);

    // 3. Log the attempt & Update Task status in a transaction
    const attemptNumber = task.reviewLogs.length + 1;
    const finalStatus = aiJudgment.approved ? "completed" : "in_progress";

    const [reviewLog, updatedTask] = await prisma.$transaction([
      prisma.taskReviewLog.create({
        data: {
          taskId,
          attemptNumber,
          aiJudgment: aiJudgment.approved ? "APPROVED" : "REJECTED",
          aiScore: aiJudgment.score,
          aiFeedback: aiJudgment.summary,
          snapshotData: task.subTasks // Archive exactly what they submitted
        }
      }),
      prisma.task.update({
        where: { id: taskId },
        data: {
          status: finalStatus,
          aiConfidenceScore: aiJudgment.score,
          aiSummary: aiJudgment.summary,
          requiresHumanQA: aiJudgment.requiresHumanQA
        }
      })
    ]);

    res.status(200).json({ 
      success: true, 
      message: aiJudgment.approved ? "Task approved and completed." : "Task requires revision.",
      data: {
        status: updatedTask.status,
        aiSummary: updatedTask.aiSummary,
        aiConfidenceScore: updatedTask.aiConfidenceScore
      }
    });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


