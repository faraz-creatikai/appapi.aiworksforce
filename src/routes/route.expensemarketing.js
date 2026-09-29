import express from "express";
import {
  createExpenseMarketing,
  deleteExpenseMarketing,
  getExpenseMarketing,
  getExpenseMarketingById,
  updateExpenseMarketing,
} from "../controllers/controller.expenseMarketing.js";

import { validate } from "../middlewares/validate.js";
import {
  createExpenseMarketingValidator,
  updateExpenseMarketingValidator,
} from "../validators/expenseMarketingVAlidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const ExpenseMarketingRoutes = express.Router();

ExpenseMarketingRoutes.use(protectRoute);
ExpenseMarketingRoutes.use(isAdministrator);

ExpenseMarketingRoutes.get("/", getExpenseMarketing);
ExpenseMarketingRoutes.get("/:id", getExpenseMarketingById);
ExpenseMarketingRoutes.post(
  "/",
  validate(createExpenseMarketingValidator),
  createExpenseMarketing
);
ExpenseMarketingRoutes.put(
  "/:id",
  validate(updateExpenseMarketingValidator),
  updateExpenseMarketing
);
ExpenseMarketingRoutes.delete("/:id", deleteExpenseMarketing);

export default ExpenseMarketingRoutes;
