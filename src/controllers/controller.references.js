import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// Helper to match MongoDB format
const transformReference = (ref) => ({
  _id: ref.id,
  Name: ref.Name,
  Status: ref.Status,
  createdAt: ref.createdAt,
  updatedAt: ref.updatedAt,
});

// =====================================
// GET ALL REFERENCES
// =====================================
export const getReference = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    let where = {};

    if (keyword) {
      where.Name = { contains: keyword, mode: "insensitive" };
    }

    const references = await prisma.reference.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(references.map(transformReference));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =====================================
// GET REFERENCE BY ID
// =====================================
export const getReferenceById = async (req, res, next) => {
  try {
    const reference = await prisma.reference.findUnique({
      where: { id: req.params.id },
    });

    if (!reference) {
      return next(new ApiError(404, "Reference not found"));
    }

    res.status(200).json(transformReference(reference));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =====================================
// CREATE REFERENCE
// =====================================
export const createReference = async (req, res, next) => {
  try {
    const { Name, Status } = req.body;

    const createdRef = await prisma.reference.create({
      data: { Name, Status },
    });

    res.status(201).json(transformReference(createdRef));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// =====================================
// UPDATE REFERENCE
// =====================================
export const updateReference = async (req, res, next) => {
  try {
    const data = { ...req.body };

    // ❌ Remove forbidden fields
    delete data._id;
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;

    const updatedRef = await prisma.reference.update({
      where: { id: req.params.id },
      data,
    });

    res.status(200).json(transformReference(updatedRef));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Reference not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// =====================================
// DELETE REFERENCE
// =====================================
export const deleteReference = async (req, res, next) => {
  try {
    await prisma.reference.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "Reference deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Reference not found"));
    }
    next(new ApiError(500, error.message));
  }
};
