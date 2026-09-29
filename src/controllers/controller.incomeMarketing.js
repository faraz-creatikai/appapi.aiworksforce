import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// Transform helper
const transformIncomeMarketing = (i) => ({
  _id: i.id,
  Date: i.Date,
  PartyName: i.PartyName,
  User: i.User,
  Income: i.Income,
  Amount: i.Amount,
  DueAmount: i.DueAmount,
  PaymentMethode: i.PaymentMethode,
  Status: i.Status,
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
});

// ✅ GET ALL
export const getIncomeMarketing = async (req, res, next) => {
  try {
    const { User, Income, PaymentMethode, keyword, limit } = req.query;

    let where = { AND: [] };

    if (User)
      where.AND.push({
        User: { contains: User, mode: "insensitive" },
      });

    if (Income)
      where.AND.push({
        Income: { contains: Income, mode: "insensitive" },
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
          { Income: { contains: keyword, mode: "insensitive" } },
        ],
      });

    // If no filters → remove AND
    if (where.AND.length === 0) delete where.AND;

    const data = await prisma.incomeMarketing.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(data.map(transformIncomeMarketing));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ✅ GET BY ID
export const getIncomeMarketingById = async (req, res, next) => {
  try {
    const entry = await prisma.incomeMarketing.findUnique({
      where: { id: req.params.id },
    });

    if (!entry) return next(new ApiError(404, "Income record not found"));

    res.status(200).json(transformIncomeMarketing(entry));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ✅ CREATE
export const createIncomeMarketing = async (req, res, next) => {
  try {
    const {
      Date,
      PartyName,
      User,
      Income,
      Amount,
      DueAmount,
      PaymentMethode,
      Status,
    } = req.body;

    const newEntry = await prisma.incomeMarketing.create({
      data: {
        Date,
        PartyName,
        User,
        Income,
        Amount,
        DueAmount,
        PaymentMethode,
        Status,
      },
    });

    res.status(201).json(transformIncomeMarketing(newEntry));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// ✅ UPDATE
export const updateIncomeMarketing = async (req, res, next) => {
  try {
    const { id } = req.params;

    const updated = await prisma.incomeMarketing.update({
      where: { id },
      data: req.body,
    });

    res.status(200).json(transformIncomeMarketing(updated));
  } catch (error) {
    if (error.code === "P2025")
      return next(new ApiError(404, "Income record not found"));
    next(new ApiError(400, error.message));
  }
};

// ✅ DELETE
export const deleteIncomeMarketing = async (req, res, next) => {
  try {
    await prisma.incomeMarketing.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "Income record deleted successfully" });
  } catch (error) {
    if (error.code === "P2025")
      return next(new ApiError(404, "Income record not found"));
    next(new ApiError(500, error.message));
  }
};
