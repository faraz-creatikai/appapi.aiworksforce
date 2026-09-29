import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// Helper to match MongoDB format
const transformCustomerFields = (ref) => ({
  _id: ref.id,
  Name: ref.Name,
  Status: ref.Status,
  createdAt: ref.createdAt,
  updatedAt: ref.updatedAt,
});

// =====================================
// GET ALL CustomerFieldsS
// =====================================
export const getCustomerFields = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    let where = {};

    if (keyword) {
      where.Name = { contains: keyword, mode: "insensitive" };
    }

    const customerFields = await prisma.customerFields.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(customerFields.map(transformCustomerFields));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =====================================
// GET PRICE BY ID
// =====================================
export const getCustomerFieldsById = async (req, res, next) => {
  try {
    const customerFields = await prisma.customerFields.findUnique({
      where: { id: req.params.id },
    });

    if (!customerFields) {
      return next(new ApiError(404, "CustomerFields not found"));
    }

    res.status(200).json(transformCustomerFields(customerFields));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =====================================
// CREATE PRICE
// =====================================
export const createCustomerFields = async (req, res, next) => {
  try {
    const { Name, Status } = req.body;

    const createdRef = await prisma.customerFields.create({
      data: { Name, Status },
    });

    res.status(201).json(transformCustomerFields(createdRef));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// =====================================
// UPDATE PRICE
// =====================================
export const updateCustomerFields = async (req, res, next) => {
  try {
    const data = { ...req.body };

    // ❌ Remove forbidden fields
    delete data._id;
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;

    const updatedRef = await prisma.customerFields.update({
      where: { id: req.params.id },
      data,
    });

    res.status(200).json(transformCustomerFields(updatedRef));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "CustomerFields not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// =====================================
// DELETE PRICE
// =====================================
export const deleteCustomerFields = async (req, res, next) => {
  try {
    await prisma.customerFields.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "CustomerFields deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "CustomerFields not found"));
    }
    next(new ApiError(500, error.message));
  }
};
