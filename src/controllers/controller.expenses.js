import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// Transform MySQL Prisma data → MongoDB format
const transformExpense = (e) => ({
  _id: e.id,
  Name: e.Name,
  Status: e.Status,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
});

// ======================================================
// GET ALL EXPENSES
// ======================================================
export const getExpense = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    let where = {};

    if (keyword) {
      where.Name = { contains: keyword, mode: "insensitive" };
    }

    const expenses = await prisma.expense.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(expenses.map(transformExpense));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ======================================================
// GET EXPENSE BY ID
// ======================================================
export const getExpenseById = async (req, res, next) => {
  try {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
    });

    if (!expense) {
      return next(new ApiError(404, "Expense not found"));
    }

    res.status(200).json(transformExpense(expense));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ======================================================
// CREATE EXPENSE
// ======================================================
export const createExpense = async (req, res, next) => {
  try {
    const { Name, Status } = req.body;

    const newExpense = await prisma.expense.create({
      data: { Name, Status },
    });

    res.status(201).json(transformExpense(newExpense));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// ======================================================
// UPDATE EXPENSE
// ======================================================
export const updateExpense = async (req, res, next) => {
  try {
    const data = { ...req.body };

    // ❌ Remove fields prisma does NOT accept
    delete data._id;
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;

    const updatedExpense = await prisma.expense.update({
      where: { id: req.params.id },
      data,
    });

    res.status(200).json(transformExpense(updatedExpense));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Expense not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// ======================================================
// DELETE EXPENSE
// ======================================================
export const deleteExpense = async (req, res, next) => {
  try {
    await prisma.expense.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "Expense deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Expense not found"));
    }
    next(new ApiError(500, error.message));
  }
};
