import express from "express";


import { validate } from "../middlewares/validate.js";
import {
  createLocationValidator,
  updateLocationValidator,
} from "../validators/locationvalidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";
import { createSubLocation, deleteAllSubLocations, deleteSubLocation, getSubLocation, getSubLocationByCityLocation, getSubLocationById, updateSubLocation } from "../controllers/controller.sublocation.js";
import { createSubLocationValidator, updateSubLocationValidator } from "../validators/sublocationvalidator.js";

const sublocationRoutes = express.Router();
sublocationRoutes.use(protectRoute);

sublocationRoutes.get("/", getSubLocation);
sublocationRoutes.get("/:id", isAdministrator, getSubLocationById);
sublocationRoutes.get("/cityloc/:cityId/:locationId", getSubLocationByCityLocation);
sublocationRoutes.post(
  "/",
  isAdministrator,
  validate(createSubLocationValidator),
  createSubLocation
);
sublocationRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateSubLocationValidator),
  updateSubLocation
);
sublocationRoutes.delete("/:id", isAdministrator, deleteSubLocation);
sublocationRoutes.delete("/", isAdministrator, deleteAllSubLocations);

export default sublocationRoutes;
