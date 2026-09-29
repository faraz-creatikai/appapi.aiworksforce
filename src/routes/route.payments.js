import express from "express";
import {
  createPayment,
  deletePayment,
  getPayment,
  getPaymentById,
  updatePayment,
} from "../controllers/controller.payment.js";

import { validate } from "../middlewares/validate.js";
import {
  createPaymentValidator,
  updatePaymentValidator,
} from "../validators/paymentsvalidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const paymentRoutes = express.Router();

paymentRoutes.use(protectRoute);

paymentRoutes.get("/", getPayment);
paymentRoutes.get("/:id", isAdministrator, getPaymentById);
paymentRoutes.post(
  "/",
  isAdministrator,
  validate(createPaymentValidator),
  createPayment
);
paymentRoutes.put(
  "/:id",
  isAdministrator,
  validate(updatePaymentValidator),
  updatePayment
);
paymentRoutes.delete("/:id", isAdministrator, deletePayment);

export default paymentRoutes;
