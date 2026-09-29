import prisma from "../../config/prismaClient.js";


const getUplineAdmins = async (adminId) => {
  let receivers = [];

  let current = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { createdBy: true },
  });

  while (current?.createdBy) {
    receivers.push(current.createdBy);

    current = await prisma.admin.findUnique({
      where: { id: current.createdBy },
      select: { createdBy: true },
    });
  }

  return receivers;
};

const getDownlineAdmins = async (adminId) => {
  const admins = await prisma.admin.findMany({
    where: { createdBy: adminId },
    select: { id: true },
  });

  return admins.map(a => a.id);
};

const self = async (adminId) => [adminId];

export const getNotificationReceivers = async (admin) => {
  // CASE 1: USER → notify its creators (city_admin + client_admin)
  if (admin.role === "user") {
    return await getUplineAdmins(admin.id);
  }

  // CASE 2: CITY ADMIN → notify creator (client_admin) + own users
  if (admin.role === "city_admin") {
    const up = await getUplineAdmins(admin.id);
    const down = await getDownlineAdmins(admin.id);

    return [...up, ...down];
  }

  // CASE 3: CLIENT ADMIN → notify all created admins
  if (admin.role === "client_admin") {
    return await getDownlineAdmins(admin.id);
  }

  // CASE 4: SUPER ADMIN → notify everyone
  if (admin.role === "administrator") {
    const all = await prisma.admin.findMany({
      select: { id: true },
    });
    return all.map(a => a.id);
  }

  return [];
};



export const getNotificationReceiversIncludingSelf = async (admin) => {
  const receivers = await getNotificationReceivers(admin);
  return [...receivers, admin.id];
};


// Customers who should hear about a task update (a task belongs to one customer)
export const getCustomerReceiversForTask = (task) => (task?.customerId ? [task.customerId] : []);