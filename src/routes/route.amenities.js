import express from "express";
import {
  createAmenity,
  deleteAmenity,
  getAmenity,
  getAmenityById,
  updateAmenity,
} from "../controllers/controller.amenities.js";

import { validate } from "../middlewares/validate.js";
import {
  createAmenityValidator,
  updateAmenityValidator,
} from "../validators/amenitiesvalidator.js";
import {
  isAdministrator,
  isCityAdminOrAbove,
  protectRoute,
} from "../middlewares/auth.js";

const amenityRoutes = express.Router();
amenityRoutes.use(protectRoute);

amenityRoutes.get("/", getAmenity);
amenityRoutes.get("/:id", isAdministrator, getAmenityById);
amenityRoutes.post(
  "/",
  isAdministrator,
  validate(createAmenityValidator),
  createAmenity
);
amenityRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateAmenityValidator),
  updateAmenity
);
amenityRoutes.delete("/:id", isAdministrator, deleteAmenity);

export default amenityRoutes;
