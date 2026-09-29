import prisma from "../config/prismaClient.js";

// ============================================================================
// 1. TOOL DEFINITIONS 
// ============================================================================
export const agentToolsDefinitions = [
  {
    name: "get_employee_pending_tasks",
    description: "Fetches the current pending tasks and their details for a specific employee.",
    parameters: {
      type: "object",
      properties: {
        employeeName: { type: "string", description: "The first or full name of the employee" }
      },
      required: ["employeeName"]
    }
  },
  {
    name: "analyze_team_attendance",
    description: "Generates an attendance and work-hours report for the team or a specific employee over a given number of days.",
    parameters: {
      type: "object",
      properties: {
        daysBack: { type: "number", description: "Number of days to look back (e.g., 7 for a week, 30 for a month)." },
        employeeName: { type: "string", description: "Optional. Filter by a specific employee's name." }
      },
      required: ["daysBack"]
    }
  },
  {
    name: "get_overdue_tasks_report",
    description: "Fetches a risk report of all overdue tasks that are not yet completed, grouped by employee.",
    parameters: {
      type: "object",
      properties: {
        department: { type: "string", description: "Optional. Filter by a specific Department name." } // 🚨 UPDATED
      },
      required: []
    }
  },
  {
    name: "get_employee_performance_metrics",
    description: "Calculates deep performance metrics for an employee, including task completion rates and subtask step progression.",
    parameters: {
      type: "object",
      properties: {
        employeeName: { type: "string", description: "The first or full name of the employee." }
      },
      required: ["employeeName"]
    }
  },

  {
    name: "get_client_project_status",
    description: "Fetches the live project status, pending tasks, and assigned team members for a specific client.",
    parameters: {
      type: "object",
      properties: {
        clientName: { type: "string", description: "The name of the client or company to check." }
      },
      required: ["clientName"]
    }
  }
];

// ============================================================================
// 2. TOOL HANDLERS (The Backend Logic)
// ============================================================================
export const agentToolsHandlers = {

  get_employee_pending_tasks: async ({ employeeName }) => {
    try {
      // 🚨 UPDATED: prisma.employee
      const employee = await prisma.employee.findFirst({
        where: { employeeName: { contains: employeeName } },
        include: {
          assignedTasks: {
            where: { status: { not: "completed" } },
            select: { title: true, priority: true, dueDate: true, status: true }
          }
        }
      });

      if (!employee) return { error: `No employee found matching '${employeeName}'.` };

      return {
        employee: employee.employeeName,
        pendingTasksCount: employee.assignedTasks.length,
        tasks: employee.assignedTasks
      };
    } catch (error) {
      console.error("Tool Execution Error:", error);
      return { error: "Failed to fetch tasks." };
    }
  },

  analyze_team_attendance: async ({ daysBack, employeeName }) => {
    try {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - daysBack);

      const whereClause = { createdAt: { gte: targetDate } };
      if (employeeName) {
        whereClause.employee = { employeeName: { contains: employeeName } }; // 🚨 UPDATED
      }

      // 🚨 UPDATED: prisma.employeeAttendance
      const logs = await prisma.employeeAttendance.findMany({
        where: whereClause,
        include: { employee: { select: { employeeName: true, Department: true } } }
      });

      if (logs.length === 0) return { message: `No attendance records found for the last ${daysBack} days.` };

      let totalMinutes = 0;
      const statusCounts = { present: 0, absent: 0, half_day: 0, workfromhome: 0, leave: 0 };
      const employeeStats = {};

      logs.forEach(log => {
        statusCounts[log.status] = (statusCounts[log.status] || 0) + 1;
        totalMinutes += log.totalMinutes || 0;

        const name = log.employee.employeeName; // 🚨 UPDATED
        if (!employeeStats[name]) employeeStats[name] = { present: 0, absent: 0, totalMinutes: 0 };
        employeeStats[name].totalMinutes += log.totalMinutes || 0;
        if (log.status === "present" || log.status === "workfromhome") employeeStats[name].present++;
        if (log.status === "absent" || log.status === "leave") employeeStats[name].absent++;
      });

      return {
        timeframe: `Last ${daysBack} days`,
        totalRecords: logs.length,
        overallStatusCounts: statusCounts,
        totalHoursLogged: Math.round(totalMinutes / 60),
        breakdownByEmployee: employeeStats
      };
    } catch (error) {
      console.error("Tool Execution Error:", error);
      return { error: "Failed to analyze attendance data." };
    }
  },

  get_overdue_tasks_report: async ({ department }) => { // 🚨 UPDATED
    try {
      const whereClause = {
        status: { not: "completed" },
        dueDate: { lt: new Date() }
      };

      if (department) {
        whereClause.assignedTo = { Department: { contains: department } }; // 🚨 UPDATED
      }

      const overdueTasks = await prisma.task.findMany({
        where: whereClause,
        include: {
          assignedTo: { select: { employeeName: true, Department: true } }, // 🚨 UPDATED
          subTasks: { select: { isCompleted: true } }
        },
        orderBy: { dueDate: 'asc' }
      });

      if (overdueTasks.length === 0) return { message: "Great news! There are no overdue tasks." };

      const formattedTasks = overdueTasks.map(t => {
        const totalSteps = t.subTasks.length;
        const completedSteps = t.subTasks.filter(st => st.isCompleted).length;

        return {
          title: t.title,
          assignedTo: t.assignedTo.employeeName,
          department: t.assignedTo.Department,
          priority: t.priority,
          daysOverdue: Math.floor((new Date() - new Date(t.dueDate)) / (1000 * 60 * 60 * 24)),
          progress: totalSteps > 0 ? `${completedSteps}/${totalSteps} steps done` : "No subtasks"
        };
      });

      return {
        totalOverdue: overdueTasks.length,
        criticalRisks: formattedTasks.filter(t => t.priority === 'urgent' || t.priority === 'high'),
        allOverdueTasks: formattedTasks
      };
    } catch (error) {
      console.error("Tool Execution Error:", error);
      return { error: "Failed to fetch overdue tasks." };
    }
  },

  get_employee_performance_metrics: async ({ employeeName }) => {
    try {
      // 🚨 UPDATED: prisma.employee
      const employee = await prisma.employee.findFirst({
        where: { employeeName: { contains: employeeName } },
        include: {
          assignedTasks: {
            include: { subTasks: true }
          }
        }
      });

      if (!employee) return { error: `Could not find an employee named '${employeeName}'.` };

      const tasks = employee.assignedTasks;
      const totalTasks = tasks.length;
      if (totalTasks === 0) return { message: `${employee.employeeName} has no assigned tasks.` };

      const completedTasks = tasks.filter(t => t.status === "completed").length;
      const pendingTasks = tasks.filter(t => t.status !== "completed").length;
      const overdueTasks = tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "completed").length;

      let totalSubTasks = 0;
      let completedSubTasks = 0;

      tasks.forEach(t => {
        totalSubTasks += t.subTasks.length;
        completedSubTasks += t.subTasks.filter(st => st.status === "completed" || st.isCompleted).length;
      });

      return {
        employeeName: employee.employeeName,
        department: employee.Department, // 🚨 UPDATED
        macroMetrics: {
          totalAssigned: totalTasks,
          completed: completedTasks,
          pending: pendingTasks,
          overdue: overdueTasks,
          completionRate: `${Math.round((completedTasks / totalTasks) * 100)}%`
        },
        microMetrics: {
          totalStepsAssigned: totalSubTasks,
          stepsCompleted: completedSubTasks,
          stepCompletionRate: totalSubTasks > 0 ? `${Math.round((completedSubTasks / totalSubTasks) * 100)}%` : "N/A"
        }
      };
    } catch (error) {
      console.error("Tool Execution Error:", error);
      return { error: "Failed to calculate performance metrics." };
    }
  },
  // NEW: Client Project Tracker Tool
  get_client_project_status: async ({ clientName }, context) => {
    try {
      let whereClause = {};

      // 🚨 ABSOLUTE SECURITY LOCK 🚨
      // If the user is a customer, ignore the AI's "clientName" parameter entirely.
      // Force the database to only look up their exact user ID.
      if (context?.userType === "customer") {
        whereClause = { id: context.userId };
      } else {
        // If it's an admin/employee, let them search by name
        whereClause = { customerName: { contains: clientName } };
      }

      const client = await prisma.customer.findFirst({
        where: whereClause,
        include: {
          assignedTeam: { select: { employeeName: true, Role: true } },
          projectTasks: {
            include: { subTasks: { select: { isCompleted: true, status: true } } }
          }
        }
      });

      if (!client) {
        if (context?.userType === "customer") {
          return { error: "No active projects found for your account." };
        }
        return { error: `Could not find a client matching '${clientName}'.` };
      }

      const tasks = client.projectTasks;
      const completedTasks = tasks.filter(t => t.status === "completed").length;
      const pendingTasks = tasks.filter(t => t.status !== "completed");

      let totalSteps = 0;
      let completedSteps = 0;
      tasks.forEach(t => {
        totalSteps += t.subTasks.length;
        completedSteps += t.subTasks.filter(st => st.isCompleted || st.status === 'completed').length;
      });

      return {
        clientName: client.customerName,
        teamAssigned: client.assignedTeam.map(emp => `${emp.employeeName} (${emp.Role})`),
        projectOverview: {
          totalTasks: tasks.length,
          completedTasks: completedTasks,
          activeTasks: pendingTasks.map(t => ({ title: t.title, priority: t.priority })),
          overallProgress: totalSteps > 0 ? `${Math.round((completedSteps / totalSteps) * 100)}%` : "0%"
        }
      };
    } catch (error) {
      console.error("Tool Execution Error:", error);
      return { error: "Failed to fetch client project status." };
    }
  }
};

