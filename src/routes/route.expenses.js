import express from "express";
import {
  createExpense,
  deleteExpense,
  getExpense,
  getExpenseById,
  updateExpense,
} from "../controllers/controller.expenses.js";

import { validate } from "../middlewares/validate.js";
import {
  createExpenseValidator,
  updateExpenseValidator,
} from "../validators/expensevalidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const expenseRoutes = express.Router();

expenseRoutes.use(protectRoute);

expenseRoutes.get("/", getExpense);
expenseRoutes.get("/:id", isAdministrator, getExpenseById);
expenseRoutes.post(
  "/",
  isAdministrator,
  validate(createExpenseValidator),
  createExpense
);
expenseRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateExpenseValidator),
  updateExpense
);
expenseRoutes.delete("/:id", isAdministrator, deleteExpense);

export default expenseRoutes;
