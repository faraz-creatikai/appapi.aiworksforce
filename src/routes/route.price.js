import express from "express";


import { validate } from "../middlewares/validate.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";
import { createPrice, deletePrice, getPrice, getPriceById, updatePrice } from "../controllers/controller.price.js";
import { createPriceValidator, updatePriceValidator } from "../validators/priceValidator.js";

const priceRoutes = express.Router();

priceRoutes.use(protectRoute);

priceRoutes.get("/", getPrice);
priceRoutes.get("/:id", isAdministrator, getPriceById);
priceRoutes.post(
  "/",
  isAdministrator,
  validate(createPriceValidator),
  createPrice
);
priceRoutes.put(
  "/:id",
  isAdministrator,
  validate(updatePriceValidator),
  updatePrice
);
priceRoutes.delete("/:id", isAdministrator, deletePrice);

export default priceRoutes;
