import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

export const transformPayment = (payment) => ({
  _id: payment.id, // MongoDB style
  Name: payment.Name,
  Status: payment.Status,
  createdAt: payment.createdAt,
  updatedAt: payment.updatedAt,
});

export const getPayment = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    let where = {};
    if (keyword) {
      where.Name = { contains: keyword, mode: "insensitive" };
    }

    const payments = await prisma.paymentMethod.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(payments.map(transformPayment));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const getPaymentById = async (req, res, next) => {
  try {
    const payment = await prisma.paymentMethod.findUnique({
      where: { id: req.params.id },
    });

    if (!payment) return next(new ApiError(404, "Payment not found"));

    res.status(200).json(transformPayment(payment));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const updatePayment = async (req, res, next) => {
  try {
    const { id } = req.params;

    const updatedPayment = await prisma.paymentMethod.update({
      where: { id },
      data: req.body,
    });

    res.status(200).json(transformPayment(updatedPayment));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Payment not found"));
    }
    next(new ApiError(400, error.message));
  }
};

export const createPayment = async (req, res, next) => {
  try {
    const { Name, Status } = req.body;

    const newPayment = await prisma.paymentMethod.create({
      data: { Name, Status },
    });

    res.status(201).json(transformPayment(newPayment));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

export const deletePayment = async (req, res, next) => {
  try {
    await prisma.paymentMethod.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "Payment deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Payment not found"));
    }
    next(new ApiError(500, error.message));
  }
};
