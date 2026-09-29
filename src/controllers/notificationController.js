import prisma from "../config/prismaClient.js";
import { getIO } from "../socket/socket.js";




//old without socket
/* export const sendNotification = async ({
  type,
  title,
  message,
  entityId,
  entityType,
  receiverIds = [],
  senderId,
  metadata = {},
}) => {
  try {
    if (!receiverIds.length) return;

    const notifications = receiverIds.map((receiverId) => ({
      type,
      title,
      message,
      entityId,
      entityType,
      receiverId,
      senderId,
      metadata,
    }));

    const notificationResult = await prisma.notification.createMany({
      data: notifications,
    });

    console.log("Notification sent to receivers:", receiverIds);
    console.log("Notification creation result:", notificationResult);

  } catch (error) {
    console.error("Notification Error:", error);
  }
}; */


//new with socket


// notificationController.js
export const sendNotification = async ({
  type, title, message, entityId, entityType,
  receiverIds = [], senderId, metadata = {},
}) => {
  try {
    if (!receiverIds.length) return;

    const created = await Promise.all(
      receiverIds.map((receiverId) =>
        prisma.notification.create({
          data: { type, title, message, entityId, entityType, receiverId, senderId, metadata },
        })
      )
    );

    const io = getIO();
    created.forEach((notif) => {
      io.to(`admin:${notif.receiverId}`).emit("notification", notif);
    });

  } catch (error) {
    console.error("Notification Error:", error);
  }
};

export const getMyNotifications = async (req, res, next) => {
  try {
    const admin = req.admin;

    const { page = 1, limit = 20, unreadOnly } = req.query;

    const where = {
      receiverId: admin.id,
      ...(unreadOnly === "true" && { isRead: false }),
    };

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });

    const total = await prisma.notification.count({ where });

    res.json({
      success: true,
      data: notifications,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
      },
    });

  } catch (error) {
    next(error);
  }
};

export const markNotificationRead = async (req, res, next) => {
  try {
    const { id } = req.params;

    await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    res.json({ success: true });

  } catch (error) {
    next(error);
  }
};

export const markAllNotificationsRead = async (req, res, next) => {
  try {
    const admin = req.admin;

    await prisma.notification.updateMany({
      where: {
        receiverId: admin.id,
        isRead: false,
      },
      data: { isRead: true },
    });

    res.json({ success: true });

  } catch (error) {
    next(error);
  }
};

