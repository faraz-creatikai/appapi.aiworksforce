import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// Helper: Convert Prisma → MongoDB-style response
const transformFunctionalArea = (area) => ({
  _id: area.id,
  Name: area.Name,
  Status: area.Status,
  createdAt: area.createdAt,
  updatedAt: area.updatedAt,
});

// GET ALL FUNCTIONAL AREAS
export const getFunctionalArea = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    let where = {};

    if (keyword) {
      where.Name = { contains: keyword, mode: "insensitive" };
    }

    const functionalAreas = await prisma.functionalArea.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(functionalAreas.map(transformFunctionalArea));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// GET FUNCTIONAL AREA BY ID
export const getFunctionalAreaById = async (req, res, next) => {
  try {
    const functionalArea = await prisma.functionalArea.findUnique({
      where: { id: req.params.id },
    });

    if (!functionalArea)
      return next(new ApiError(404, "Functional Area not found"));

    res.status(200).json(transformFunctionalArea(functionalArea));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// CREATE FUNCTIONAL AREA
export const createFunctionalArea = async (req, res, next) => {
  try {
    const { Name, Status } = req.body;

    const newFunctionalArea = await prisma.functionalArea.create({
      data: { Name, Status },
    });

    res.status(201).json(transformFunctionalArea(newFunctionalArea));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

export const updateFunctionalArea = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Clone request body
    let updateData = { ...req.body };

    // ❌ Remove fields Prisma cannot update
    delete updateData.id;
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.updatedAt;
    delete updateData.CreatedBy; // if exists

    const updatedArea = await prisma.functionalArea.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json(transformFunctionalArea(updatedArea));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Functional Area not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// DELETE FUNCTIONAL AREA
export const deleteFunctionalArea = async (req, res, next) => {
  try {
    await prisma.functionalArea.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "Functional Area deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Functional Area not found"));
    }
    next(new ApiError(500, error.message));
  }
};
