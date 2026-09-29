import express from "express";
import {
  createIndustry,
  deleteIndustry,
  getIndustry,
  getIndustryById,
  updateIndustry,
} from "../controllers/controller.industries.js";

import { validate } from "../middlewares/validate.js";
import {
  createIndustryValidator,
  updateIndustryValidator,
} from "../validators/industriesvalidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const industryRoutes = express.Router();

industryRoutes.use(protectRoute);

industryRoutes.get("/", getIndustry);
industryRoutes.get("/:id", isAdministrator, getIndustryById);
industryRoutes.post(
  "/",
  isAdministrator,
  validate(createIndustryValidator),
  createIndustry
);
industryRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateIndustryValidator),
  updateIndustry
);
industryRoutes.delete("/:id", isAdministrator, deleteIndustry);

export default industryRoutes;
