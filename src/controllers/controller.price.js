import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// Helper to match MongoDB format
const transformPrice = (ref) => ({
  _id: ref.id,
  Name: ref.Name,
  Status: ref.Status,
  createdAt: ref.createdAt,
  updatedAt: ref.updatedAt,
});

// =====================================
// GET ALL PriceS
// =====================================
export const getPrice = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    let where = {};

    if (keyword) {
      where.Name = { contains: keyword, mode: "insensitive" };
    }

    const prices = await prisma.price.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(prices.map(transformPrice));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =====================================
// GET PRICE BY ID
// =====================================
export const getPriceById = async (req, res, next) => {
  try {
    const price = await prisma.price.findUnique({
      where: { id: req.params.id },
    });

    if (!price) {
      return next(new ApiError(404, "Price not found"));
    }

    res.status(200).json(transformPrice(price));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =====================================
// CREATE PRICE
// =====================================
export const createPrice = async (req, res, next) => {
  try {
    const { Name, Status } = req.body;

    const createdRef = await prisma.price.create({
      data: { Name, Status },
    });

    res.status(201).json(transformPrice(createdRef));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// =====================================
// UPDATE PRICE
// =====================================
export const updatePrice = async (req, res, next) => {
  try {
    const data = { ...req.body };

    // ❌ Remove forbidden fields
    delete data._id;
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;

    const updatedRef = await prisma.price.update({
      where: { id: req.params.id },
      data,
    });

    res.status(200).json(transformPrice(updatedRef));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Price not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// =====================================
// DELETE PRICE
// =====================================
export const deletePrice = async (req, res, next) => {
  try {
    await prisma.price.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "Price deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Price not found"));
    }
    next(new ApiError(500, error.message));
  }
};
