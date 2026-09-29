import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// Helper to keep MongoDB response format
const transformIndustry = (industry) => ({
  _id: industry.id,
  Name: industry.Name,
  Status: industry.Status,
  createdAt: industry.createdAt,
  updatedAt: industry.updatedAt,
});

// ===============================
// GET ALL INDUSTRIES
// ===============================
export const getIndustry = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    let where = {};

    if (keyword) {
      where.Name = {
        contains: keyword,
        mode: "insensitive",
      };
    }

    const industries = await prisma.industry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(industries.map(transformIndustry));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ===============================
// GET INDUSTRY BY ID
// ===============================
export const getIndustryById = async (req, res, next) => {
  try {
    const industry = await prisma.industry.findUnique({
      where: { id: req.params.id },
    });

    if (!industry) return next(new ApiError(404, "Industry not found"));

    res.status(200).json(transformIndustry(industry));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ===============================
// CREATE INDUSTRY
// ===============================
export const createIndustry = async (req, res, next) => {
  try {
    const { Name, Status } = req.body;

    const newIndustry = await prisma.industry.create({
      data: { Name, Status },
    });

    res.status(201).json(transformIndustry(newIndustry));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// ===============================
// UPDATE INDUSTRY
// ===============================
export const updateIndustry = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Clone the request body
    let updateData = { ...req.body };

    // ❌ Remove fields Prisma cannot update
    delete updateData.id;
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.updatedAt;
    delete updateData.CreatedBy; // if exists

    const updatedIndustry = await prisma.industry.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json(transformIndustry(updatedIndustry));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Industry not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// ===============================
// DELETE INDUSTRY
// ===============================
export const deleteIndustry = async (req, res, next) => {
  try {
    await prisma.industry.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "Industry deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Industry not found"));
    }
    next(new ApiError(500, error.message));
  }
};
