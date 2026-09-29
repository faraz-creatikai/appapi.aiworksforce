import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// Transform helper so frontend does NOT break
const transformContactStatusType = (cStatus) => ({
  _id: cStatus.id,
  Name: cStatus.Name,
  Status: cStatus.Status,
  createdAt: cStatus.createdAt,
  updatedAt: cStatus.updatedAt,
});

// =================== GET ALL ===================
export const getStatustype = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    let where = {};

    if (keyword) {
      where.Name = {
        contains: keyword,
        mode: "insensitive",
      };
    }

    const statustypes = await prisma.contactStatusType.findMany({
      where,
      orderBy: { Name: "asc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(statustypes.map(transformContactStatusType));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =================== GET BY ID ===================
export const getStatustypeById = async (req, res, next) => {
  try {
    const statustype = await prisma.contactStatusType.findUnique({
      where: { id: req.params.id },
    });

    if (!statustype) {
      return next(new ApiError(404, "Contact Status Type not found"));
    }

    res.status(200).json(transformContactStatusType(statustype));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =================== CREATE ===================
export const createStatustype = async (req, res, next) => {
  try {
    const { Name, Status } = req.body;

    const newStatustype = await prisma.contactStatusType.create({
      data: { Name, Status },
    });

    res.status(201).json(transformContactStatusType(newStatustype));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// =================== UPDATE ===================
export const updateStatustype = async (req, res, next) => {
  try {
    const { id } = req.params;

    const updated = await prisma.contactStatusType.update({
      where: { id },
      data: req.body,
    });

    res.status(200).json(transformContactStatusType(updated));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Contact Status Type not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// =================== DELETE ===================
export const deleteStatustype = async (req, res, next) => {
  try {
    await prisma.contactStatusType.delete({
      where: { id: req.params.id },
    });

    res
      .status(200)
      .json({ message: "Contact Status Type deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Contact Status Type not found"));
    }
    next(new ApiError(500, error.message));
  }
};
