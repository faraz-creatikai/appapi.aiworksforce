import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// Helper: Convert Prisma output to MongoDB-style
const transformFacility = (facility) => ({
  _id: facility.id,
  Name: facility.Name,
  Status: facility.Status,
  createdAt: facility.createdAt,
  updatedAt: facility.updatedAt,
});

// GET ALL FACILITIES
export const getFacility = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    let where = {};

    if (keyword) {
      where.Name = { contains: keyword, mode: "insensitive" };
    }

    const facilities = await prisma.facility.findMany({
      where,
      orderBy: { Name: "asc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(facilities.map(transformFacility));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// GET FACILITY BY ID
export const getFacilityById = async (req, res, next) => {
  try {
    const facility = await prisma.facility.findUnique({
      where: { id: req.params.id },
    });

    if (!facility) return next(new ApiError(404, "Facility not found"));

    res.status(200).json(transformFacility(facility));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// CREATE FACILITY
export const createFacility = async (req, res, next) => {
  try {
    const { Name, Status } = req.body;

    const newFacility = await prisma.facility.create({
      data: { Name, Status },
    });

    res.status(201).json(transformFacility(newFacility));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// UPDATE FACILITY
export const updateFacility = async (req, res, next) => {
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

    const updatedFacility = await prisma.facility.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json(transformFacility(updatedFacility));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Facility not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// DELETE FACILITY
export const deleteFacility = async (req, res, next) => {
  try {
    await prisma.facility.delete({ where: { id: req.params.id } });

    res.status(200).json({ message: "Facility deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Facility not found"));
    }
    next(new ApiError(500, error.message));
  }
};
