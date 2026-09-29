import express from "express";
import {
  createLocation,
  deleteAllLocations,
  deleteLocation,
  getLocation,
  getLocationByCity,
  getLocationById,
  updateLocation,
} from "../controllers/controller.location.js";

import { validate } from "../middlewares/validate.js";
import {
  createLocationValidator,
  updateLocationValidator,
} from "../validators/locationvalidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const locationRoutes = express.Router();
locationRoutes.use(protectRoute);

locationRoutes.get("/", getLocation);
locationRoutes.get("/:id", isAdministrator, getLocationById);
locationRoutes.get("/city/:cityId", getLocationByCity);
locationRoutes.post(
  "/",
  isAdministrator,
  validate(createLocationValidator),
  createLocation
);
locationRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateLocationValidator),
  updateLocation
);
locationRoutes.delete("/:id", isAdministrator, deleteLocation);
locationRoutes.delete("/", isAdministrator, deleteAllLocations);

export default locationRoutes;
