import express from "express";
import {
  createIncomeMarketing,
  deleteIncomeMarketing,
  getIncomeMarketing,
  getIncomeMarketingById,
  updateIncomeMarketing,
} from "../controllers/controller.incomeMarketing.js";

import { validate } from "../middlewares/validate.js";
import {
  createIncomeMarketingValidator,
  updateIncomeMarketingValidator,
} from "../validators/incomemarketingvalidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const incomeMarketingRoutes = express.Router();

incomeMarketingRoutes.use(protectRoute);
incomeMarketingRoutes.use(isAdministrator);

incomeMarketingRoutes.get("/", getIncomeMarketing);
incomeMarketingRoutes.get("/:id", getIncomeMarketingById);
incomeMarketingRoutes.post(
  "/",
  validate(createIncomeMarketingValidator),
  createIncomeMarketing
);
incomeMarketingRoutes.put(
  "/:id",
  validate(updateIncomeMarketingValidator),
  updateIncomeMarketing
);
incomeMarketingRoutes.delete("/:id", deleteIncomeMarketing);

export default incomeMarketingRoutes;
