import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

const transformStatustype = (sType) => ({
  _id: sType.id,
  Name: sType.Name,
  Status: sType.Status,
  createdAt: sType.createdAt,
  updatedAt: sType.updatedAt,
});

// =================== GET ALL STATUS TYPES ===================
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

    const statustypes = await prisma.statusType.findMany({
      where,
      orderBy: { Name: "asc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(statustypes.map(transformStatustype));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =================== GET STATUS TYPE BY ID ===================
export const getStatustypeById = async (req, res, next) => {
  try {
    const statustype = await prisma.statusType.findUnique({
      where: { id: req.params.id },
    });

    if (!statustype) {
      return next(new ApiError(404, "Status type not found"));
    }

    res.status(200).json(transformStatustype(statustype));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =================== CREATE STATUS TYPE ===================
export const createStatustype = async (req, res, next) => {
  try {
    const { Name, Status } = req.body;

    const newStatustype = await prisma.statusType.create({
      data: { Name, Status },
    });

    res.status(201).json(transformStatustype(newStatustype));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// =================== UPDATE STATUS TYPE ===================
export const updateStatustype = async (req, res, next) => {
  try {
    const { id } = req.params;

    const updated = await prisma.statusType.update({
      where: { id },
      data: req.body,
    });

    res.status(200).json(transformStatustype(updated));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Status type not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// =================== DELETE STATUS TYPE ===================
export const deleteStatustype = async (req, res, next) => {
  try {
    await prisma.statusType.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "Status type deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Status type not found"));
    }
    next(new ApiError(500, error.message));
  }
};
