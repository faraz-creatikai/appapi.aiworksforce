import prisma from "../../config/prismaClient.js";
import { sendNotification } from "../../controllers/notificationController.js";
import { getSocket } from "../../socket/socket.js";
import { getCustomerReceiversForTask, getNotificationReceivers } from "./notificationResolver.js";


//delete old notifications every day at midnight
const NOTIFICATION_RETENTION_DAYS = 30; // ← change this one number only

export const deleteOldNotifications = async () => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - NOTIFICATION_RETENTION_DAYS);

  const result = await prisma.notification.deleteMany({
    where: {
      createdAt: { lt: cutoffDate },
      isRead: true,
    },
  });

  console.log(`🗑️ Deleted ${result.count} old notifications (older than ${NOTIFICATION_RETENTION_DAYS} days)`);
};

export const notifyCustomerCreated = async ({ customer, admin }) => {
  const receiverIds = await getNotificationReceivers(admin);

  // avoid sending notification to self
  const filteredReceivers = receiverIds.filter(id => id !== admin.id);

  await sendNotification({
    type: "CUSTOMER_CREATED",
    title: "New Customer Created",
    message: `${customer.customerName} has been added`,
    entityId: customer.id,
    entityType: "Customer",
    receiverIds: filteredReceivers,
    senderId: admin.id,
    metadata: {
      phone: customer.ContactNumber,
    },
  });
};


export const notifyCustomerFollowupTaken = async ({ customer, admin }) => {
  const receiverIds = await getNotificationReceivers(admin);

  // avoid sending notification to self
  const filteredReceivers = receiverIds.filter(id => id !== admin.id);

  await sendNotification({
    type: "CUSTOMER_FOLLOWUP_TAKEN",
    title: "Customer Follow-up Taken",
    message: `${customer.customerName} has been followed up`,
    entityId: customer.id,
    entityType: "Customer",
    receiverIds: filteredReceivers,
    senderId: admin.id,
    metadata: {
      phone: customer.ContactNumber,
    },
  });
};

export const notifyNewUserRequest = async ({ newUser }) => {
  const admins = await prisma.admin.findMany({
    where: { role: "administrator" },
    select: { id: true },
  });

  const receiverIds = admins.map(a => a.id);


  console.log("Receivers for new user request notification:", receiverIds);

  await sendNotification({
    type: "NEW_USER_REQUEST",
    title: "New User Request",
    message: `${newUser.name} has requested to create an account`,
    entityId: newUser.id,
    entityType: "User",
    receiverIds: receiverIds,
    senderId: null,
    metadata: {
      phone: newUser.phone,
    },
  });
};


//followup notify

// ─── Notify Followup Due (called manually if needed) ──────────────────────────
export const notifyFollowupNext = async ({ followup, customer }) => {
  // get all administrators
  const administrators = await prisma.admin.findMany({
    where: { role: "administrator" },
    select: { id: true },
  });
  // console.log("Administrators to notify for followup:", administrators);
  const adminIds = administrators.map(a => a.id);

  // get the one who created the followup
  const creatorId = followup.CreatedById;

  // merge both, remove duplicates
  const receiverIds = [...new Set([
    ...adminIds,
    ...(creatorId ? [creatorId] : []),
  ])];

  await sendNotification({
    type: "FOLLOWUP_DUE",
    title: "Follow Up Due",
    message: `Don’t miss the follow-up with ${customer.customerName}`,
    entityId: customer.id,
    entityType: "Customer",
    receiverIds,
    senderId: null, // system triggered, no sender
    metadata: {
      phone: customer.ContactNumber,
      followupDate: followup.FollowupNextDate,
    },
  });
};


// ─── Cron: runs every 24 hours, checks all due followups ─────────────────────
export const initFollowupNotificationCron = () => {
  setInterval(async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      console.log(` Checking due/overdue followups...`);

      // get ALL unnotified followups
      const allUnnotified = await prisma.followup.findMany({
        where: {
          isNotified: false,
          FollowupNextDate: { not: null },
        },
        include: { customer: true },
      });

      // filter: today OR any past unnotified date
      const dueFollowups = allUnnotified.filter((followup) => {
        if (!followup.FollowupNextDate) return false;

        // parse "dd-mm-yyyy" into a Date
        const [dd, mm, yyyy] = followup.FollowupNextDate.split("-");
        const followupDate = new Date(`${yyyy}-${mm}-${dd}`);
        followupDate.setHours(0, 0, 0, 0);

        return followupDate <= today; // today OR overdue ✅
      });

      console.log(` Found ${dueFollowups.length} due/overdue followups`);

      for (const followup of dueFollowups) {
        await notifyFollowupNext({ followup, customer: followup.customer });

        // mark as notified so it never fires again
        await prisma.followup.update({
          where: { id: followup.id },
          data: { isNotified: true },
        });
      }

    } catch (err) {
      console.error(" Followup notification cron error:", err);
    }
  }, 24 * 60 * 60 * 1000); // every 24 hours
};






/*
todo
  in_progress
  under_review
  completed */
// ─── CUSTOMER PROJECT UPDATES (live push only, nothing is saved) ─────────────
const STEP_TYPES = { todo: "STEP_TODO", in_progress: "STEP_STARTED", completed: "STEP_COMPLETED", under_review: "STEP_REVIEW", rejected: "STEP_REJECTED" };

const actorOf = (task) =>
  task.assignedTo ? { employeeName: task.assignedTo.employeeName, EmployeeImage: task.assignedTo.EmployeeImage } : null;

// Also used by the portal controller, so history and live events have the same shape
export const stepUpdate = (subTask, task) => {
  const type = STEP_TYPES[subTask.status];
  if (!type) return null; // "todo" is not customer-facing news
  const who = task.assignedTo?.employeeName ?? "Your team";
  const copy = {
    STEP_TODO: {
      title: "Step to do",
      message: `"${subTask.title}" is ready to be started`,
    },
    STEP_STARTED: { title: "Work started", message: `${who} started "${subTask.title}"` },
    STEP_COMPLETED: { title: "Step completed", message: `${who} completed "${subTask.title}"` },
    STEP_REVIEW: { title: " Step in Review", message: `${who} reviewing "${subTask.title}"` },
    STEP_REJECTED: { title: "Step needs revision", message: `"${subTask.title}" needs revision (${who})` },
  }[type];
  return {
    id: `step:${subTask.id}:${subTask.status}`,
    type,
    ...copy,
    projectTitle: task.title,
    taskId: task.id,
    subTaskId: subTask.id,
    createdAt: new Date(subTask.updatedAt).toISOString(),
    actor: actorOf(task),
  };
};

export const assignedUpdate = (task) => ({
  id: `task:${task.id}`,
  type: "TASK_ASSIGNED",
  title: "New team member",
  message: `${task.assignedTo?.employeeName ?? "A team member"} joined ${task.title}`,
  projectTitle: task.title,
  taskId: task.id,
  subTaskId: null,
  createdAt: new Date(task.createdAt).toISOString(),
  actor: actorOf(task),
});

const taskSelect = {
  id: true, title: true, customerId: true, createdAt: true,
  assignedTo: { select: { employeeName: true, EmployeeImage: true } },
};

const pushToCustomer = (task, update) => {
  if (!update) return;
  const io = getSocket();
  getCustomerReceiversForTask(task).forEach((customerId) =>
    io?.to(`customer:${customerId}`).emit("project:update", update)
  );
};

// Call after an employee changes a step's status
export const notifyCustomerStepChanged = async (subTaskId) => {
  try {
    const subTask = await prisma.subTask.findUnique({
      where: { id: subTaskId },
      include: { task: { select: taskSelect } },
    });
    if (subTask) pushToCustomer(subTask.task, stepUpdate(subTask, subTask.task));
  } catch (err) {
    console.error("notifyCustomerStepChanged failed:", err);
  }
};

// Call after a task is created for an employee
export const notifyCustomerTaskAssigned = async (taskId) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: taskSelect });
    if (task) pushToCustomer(task, assignedUpdate(task));
  } catch (err) {
    console.error("notifyCustomerTaskAssigned failed:", err);
  }
};