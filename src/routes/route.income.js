import express from "express";
import {
  createIncome,
  deleteIncome,
  getIncome,
  getIncomeById,
  updateIncome,
} from "../controllers/controller.income.js";

import { validate } from "../middlewares/validate.js";
import {
  createIncomeValidator,
  updateIncomeValidator,
} from "../validators/incomevalidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const incomeRoutes = express.Router();

incomeRoutes.use(protectRoute);

incomeRoutes.get("/", getIncome);
incomeRoutes.get("/:id", isAdministrator, getIncomeById);
incomeRoutes.post(
  "/",
  isAdministrator,
  validate(createIncomeValidator),
  createIncome
);
incomeRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateIncomeValidator),
  updateIncome
);
incomeRoutes.delete("/:id", isAdministrator, deleteIncome);

export default incomeRoutes;
