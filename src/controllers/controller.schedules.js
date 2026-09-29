import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

export const transformSchedule = (schedule) => ({
  _id: schedule.id,
  date: schedule.date,
  Time: schedule.Time,
  Description: schedule.Description,
  User: schedule.User,
  createdAt: schedule.createdAt,
  updatedAt: schedule.updatedAt,
});

// ------------------------------------------------------------
// ✅ GET ALL SCHEDULES
// ------------------------------------------------------------
export const getSchedule = async (req, res, next) => {
  try {
    const { User, keyword, limit } = req.query;

    let where = {};

    if (User) {
      where.User = { contains: User.trim(), mode: "insensitive" };
    }

    if (keyword) {
      where.Description = { contains: keyword, mode: "insensitive" };
    }

    const schedules = await prisma.schedule.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(schedules.map(transformSchedule));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const getScheduleById = async (req, res, next) => {
  try {
    const schedule = await prisma.schedule.findUnique({
      where: { id: req.params.id },
    });

    if (!schedule) return next(new ApiError(404, "Schedule not found"));

    res.status(200).json(transformSchedule(schedule));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const createSchedule = async (req, res, next) => {
  try {
    const { date, Time, Description, User } = req.body;

    const newSchedule = await prisma.schedule.create({
      data: { date, Time, Description, User },
    });

    res.status(201).json(transformSchedule(newSchedule));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

export const updateSchedule = async (req, res, next) => {
  try {
    // Clone body
    let updateData = { ...req.body };

    // 🚫 Remove fields that should never be updated
    delete updateData.id;
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.updatedAt;
    delete updateData.CreatedBy; // if exists

    const updatedSchedule = await prisma.schedule.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.status(200).json(transformSchedule(updatedSchedule));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Schedule not found"));
    }
    next(new ApiError(400, error.message));
  }
};

export const deleteSchedule = async (req, res, next) => {
  try {
    const { scheduleIds } = req.body;

    // DELETE ALL SCHEDULES
    if (!scheduleIds || scheduleIds.length === 0) {
      const all = await prisma.schedule.findMany();

      if (all.length === 0)
        return next(new ApiError(404, "No schedules found to delete"));

      await prisma.schedule.deleteMany();

      return res.status(200).json({
        success: true,
        message: "All schedules deleted successfully",
        deletedScheduleIds: all.map((s) => s.id),
      });
    }

    // DELETE SELECTED SCHEDULES
    await prisma.schedule.deleteMany({
      where: { id: { in: scheduleIds } },
    });

    res.status(200).json({
      success: true,
      message: "Selected schedules deleted successfully",
      deletedScheduleIds: scheduleIds,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};
