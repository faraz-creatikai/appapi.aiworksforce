import express from "express";
import {
  createCity,
  deleteCity,
  getCity,
  getCityById,
  updateCity,
} from "../controllers/controller.city.js";

import { validate } from "../middlewares/validate.js";
import {
  createCityValidator,
  updateCityValidator,
} from "../validators/cityvalidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const cityRoutes = express.Router();

cityRoutes.use(protectRoute);

cityRoutes.get("/", getCity);
cityRoutes.get("/:id", isAdministrator, getCityById);
cityRoutes.post(
  "/",
  isAdministrator,
  validate(createCityValidator),
  createCity
);
cityRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateCityValidator),
  updateCity
);
cityRoutes.delete("/:id", isAdministrator, deleteCity);

export default cityRoutes;
