import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// Helper → return MongoDB-like structure
const transformExpenseMarketing = (e) => ({
  _id: e.id,
  Date: e.Date,
  PartyName: e.PartyName,
  User: e.User,
  Expense: e.Expense,
  Amount: e.Amount,
  DueAmount: e.DueAmount,
  PaymentMethode: e.PaymentMethode,
  Status: e.Status,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
});

// ✅ GET ALL WITH FILTERS
export const getExpenseMarketing = async (req, res, next) => {
  try {
    const { User, Expense, PaymentMethode, keyword, limit } = req.query;

    let where = { AND: [] };

    if (User)
      where.AND.push({
        User: { contains: User, mode: "insensitive" },
      });

    if (Expense)
      where.AND.push({
        Expense: { contains: Expense, mode: "insensitive" },
      });

    if (PaymentMethode)
      where.AND.push({
        PaymentMethode: { contains: PaymentMethode, mode: "insensitive" },
      });

    if (keyword)
      where.AND.push({
        OR: [
          { PartyName: { contains: keyword, mode: "insensitive" } },
          { User: { contains: keyword, mode: "insensitive" } },
          { Expense: { contains: keyword, mode: "insensitive" } },
        ],
      });

    if (where.AND.length === 0) delete where.AND;

    const data = await prisma.expenseMarketing.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(data.map(transformExpenseMarketing));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ✅ GET BY ID
export const getExpenseMarketingById = async (req, res, next) => {
  try {
    const entry = await prisma.expenseMarketing.findUnique({
      where: { id: req.params.id },
    });

    if (!entry) return next(new ApiError(404, "Expense record not found"));

    res.status(200).json(transformExpenseMarketing(entry));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ✅ CREATE
export const createExpenseMarketing = async (req, res, next) => {
  try {
    const {
      Date,
      PartyName,
      User,
      Expense,
      Amount,
      DueAmount,
      PaymentMethode,
      Status,
    } = req.body;

    const newEntry = await prisma.expenseMarketing.create({
      data: {
        Date,
        PartyName,
        User,
        Expense,
        Amount,
        DueAmount,
        PaymentMethode,
        Status,
      },
    });

    res.status(201).json(transformExpenseMarketing(newEntry));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// ✅ UPDATE
export const updateExpenseMarketing = async (req, res, next) => {
  try {
    const updated = await prisma.expenseMarketing.update({
      where: { id: req.params.id },
      data: req.body,
    });

    res.status(200).json(transformExpenseMarketing(updated));
  } catch (error) {
    if (error.code === "P2025")
      return next(new ApiError(404, "Expense record not found"));
    next(new ApiError(400, error.message));
  }
};

// ✅ DELETE
export const deleteExpenseMarketing = async (req, res, next) => {
  try {
    await prisma.expenseMarketing.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "Expense record deleted successfully" });
  } catch (error) {
    if (error.code === "P2025")
      return next(new ApiError(404, "Expense record not found"));
    next(new ApiError(500, error.message));
  }
};
