import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

const transformIncome = (income) => ({
  _id: income.id,
  Name: income.Name,
  Status: income.Status,
  createdAt: income.createdAt,
  updatedAt: income.updatedAt,
});

// =================== GET ALL INCOME ===================
export const getIncome = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    let where = {};

    if (keyword) {
      where.Name = {
        contains: keyword,
        mode: "insensitive",
      };
    }

    const incomes = await prisma.income.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(incomes.map(transformIncome));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =================== GET INCOME BY ID ===================
export const getIncomeById = async (req, res, next) => {
  try {
    const income = await prisma.income.findUnique({
      where: { id: req.params.id },
    });

    if (!income) {
      return next(new ApiError(404, "Income not found"));
    }

    res.status(200).json(transformIncome(income));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =================== CREATE INCOME ===================
export const createIncome = async (req, res, next) => {
  try {
    const { Name, Status } = req.body;

    const newIncome = await prisma.income.create({
      data: { Name, Status },
    });

    res.status(201).json(transformIncome(newIncome));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// =================== UPDATE INCOME ===================
export const updateIncome = async (req, res, next) => {
  try {
    const clean = { ...req.body };

    // ❌ Prisma does NOT allow updating these
    delete clean._id;
    delete clean.id;
    delete clean.createdAt;
    delete clean.updatedAt;

    const updatedIncome = await prisma.income.update({
      where: { id: req.params.id },
      data: clean,
    });

    res.status(200).json(transformIncome(updatedIncome));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Income not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// =================== DELETE INCOME ===================
export const deleteIncome = async (req, res, next) => {
  try {
    await prisma.income.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "Income deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Income not found"));
    }
    next(new ApiError(500, error.message));
  }
};
