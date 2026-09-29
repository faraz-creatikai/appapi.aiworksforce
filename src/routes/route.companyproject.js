import express from "express";
import {
  createProject,
  getProjectById,
  getProjects,
  updateProject,
  deleteAllProjects,
  deleteProject,
} from "../controllers/controller.companyproject.js";

import upload from "../config/multer.js";
import { validate } from "../middlewares/validate.js";
import {
  createProjectValidator,
  updateProjectValidator,
} from "../validators/companyProjectValidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const companyProjectRoutes = express.Router();

// ✅ Protect all routes
companyProjectRoutes.use(protectRoute);
companyProjectRoutes.use(isAdministrator);

// ✅ Get all projects
companyProjectRoutes.get("/", getProjects);

// ✅ Get project by ID
companyProjectRoutes.get("/:id", getProjectById);

// ✅ Create new project
companyProjectRoutes.post(
  "/",
  upload.fields([
    { name: "CustomerImage", maxCount: 10 },
    { name: "SitePlan", maxCount: 5 },
  ]),
  validate(createProjectValidator),
  createProject
);

// ✅ Update existing project
companyProjectRoutes.put(
  "/:id",
  upload.fields([
    { name: "CustomerImage", maxCount: 10 },
    { name: "SitePlan", maxCount: 5 },
  ]),
  validate(updateProjectValidator),
  updateProject
);

// ✅ Delete a project by ID
companyProjectRoutes.delete("/:id", deleteProject);

// ✅ Delete all projects
companyProjectRoutes.delete("/", deleteAllProjects);

export default companyProjectRoutes;
