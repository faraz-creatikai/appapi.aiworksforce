import express from "express";
import upload from "../config/multer.js";
import {
  getBuilders,
  getBuilderById,
  createBuilder,
  updateBuilder,
  deleteBuilder,
  deleteAllBuilders,
} from "../controllers/controller.buliderslider.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import {
  createBuilderValidator,
  updateBuilderValidator,
} from "../validators/buildersliderValidator.js";

const builderRoutes = express.Router();

// Protected routes
builderRoutes.use(protectRoute);

builderRoutes.get("/", getBuilders);
builderRoutes.get("/:id", isAdministrator, getBuilderById);

builderRoutes.post(
  "/",
  isAdministrator,
  upload.fields([{ name: "Image", maxCount: 5 }]),
  validate(createBuilderValidator),
  createBuilder
);

builderRoutes.put(
  "/:id",
  isAdministrator,
  upload.fields([{ name: "Image", maxCount: 5 }]),
  updateBuilder
);

builderRoutes.delete("/:id", isAdministrator, deleteBuilder);
builderRoutes.delete("/", isAdministrator, deleteAllBuilders);

export default builderRoutes;
