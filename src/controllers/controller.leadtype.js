import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// Helper to match MongoDB format
const transformLeadType = (ref) => ({
  _id: ref.id,
  Name: ref.Name,
  Status: ref.Status,
  createdAt: ref.createdAt,
  updatedAt: ref.updatedAt,
});

// =====================================
// GET ALL LeadTypeS
// =====================================
export const getLeadType = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    let where = {};

    if (keyword) {
      where.Name = { contains: keyword, mode: "insensitive" };
    }

    const leadtypes = await prisma.leadType.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(leadtypes.map(transformLeadType));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =====================================
// GET PRICE BY ID
// =====================================
export const getLeadTypeById = async (req, res, next) => {
  try {
    const leadtype = await prisma.leadType.findUnique({
      where: { id: req.params.id },
    });

    if (!leadtype) {
      return next(new ApiError(404, "LeadType not found"));
    }

    res.status(200).json(transformLeadType(leadtype));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =====================================
// CREATE PRICE
// =====================================
export const createLeadType = async (req, res, next) => {
  try {
    const { Name, Status } = req.body;

    const createdRef = await prisma.leadType.create({
      data: { Name, Status },
    });

    res.status(201).json(transformLeadType(createdRef));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// =====================================
// UPDATE PRICE
// =====================================
export const updateLeadType = async (req, res, next) => {
  try {
    const data = { ...req.body };

    // ❌ Remove forbidden fields
    delete data._id;
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;

    const updatedRef = await prisma.leadType.update({
      where: { id: req.params.id },
      data,
    });

    res.status(200).json(transformLeadType(updatedRef));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "LeadType not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// =====================================
// DELETE PRICE
// =====================================
export const deleteLeadType = async (req, res, next) => {
  try {
    await prisma.leadType.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "LeadType deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "LeadType not found"));
    }
    next(new ApiError(500, error.message));
  }
};
