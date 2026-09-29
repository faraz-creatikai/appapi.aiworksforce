import express from "express";
import {
  createFacility,
  deleteFacility,
  getFacility,
  getFacilityById,
  updateFacility,
} from "../controllers/controller.facilities.js";

import { validate } from "../middlewares/validate.js";
import {
  createFacilityValidator,
  updateFacilityValidator,
} from "../validators/facilitiesvalidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const facilitiesRoutes = express.Router();

facilitiesRoutes.use(protectRoute);

facilitiesRoutes.get("/", getFacility);
facilitiesRoutes.get("/:id", isAdministrator, getFacilityById);
facilitiesRoutes.post(
  "/",
  isAdministrator,
  validate(createFacilityValidator),
  createFacility
);
facilitiesRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateFacilityValidator),
  updateFacility
);
facilitiesRoutes.delete("/:id", isAdministrator, deleteFacility);

export default facilitiesRoutes;
