import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// MongoDB-style transformation
const transformAmenity = (amenity) => ({
  _id: amenity.id,
  Name: amenity.Name,
  Status: amenity.Status,
  createdAt: amenity.createdAt,
  updatedAt: amenity.updatedAt,
});

// GET ALL AMENITIES
export const getAmenity = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    let where = {};

    if (keyword) {
      where.Name = { contains: keyword, mode: "insensitive" };
    }

    const amenities = await prisma.amenity.findMany({
      where,
      orderBy: { Name: "asc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(amenities.map(transformAmenity));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// GET AMENITY BY ID
export const getAmenityById = async (req, res, next) => {
  try {
    const amenity = await prisma.amenity.findUnique({
      where: { id: req.params.id },
    });

    if (!amenity) return next(new ApiError(404, "Amenity not found"));

    res.status(200).json(transformAmenity(amenity));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// CREATE AMENITY
export const createAmenity = async (req, res, next) => {
  try {
    const { Name, Status } = req.body;

    const newAmenity = await prisma.amenity.create({
      data: { Name, Status },
    });

    res.status(201).json(transformAmenity(newAmenity));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// UPDATE AMENITY
export const updateAmenity = async (req, res, next) => {
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

    const updatedAmenity = await prisma.amenity.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json(transformAmenity(updatedAmenity));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Amenity not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// DELETE AMENITY
export const deleteAmenity = async (req, res, next) => {
  try {
    await prisma.amenity.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "Amenity deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Amenity not found"));
    }
    next(new ApiError(500, error.message));
  }
};
