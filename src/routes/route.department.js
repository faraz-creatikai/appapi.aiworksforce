import express from "express";
import {
  createDepartment,
  deleteDepartment,
  getDepartment,
  getDepartmentById,
  updateDepartment,
} from "../controllers/controller.department.js";

import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const departmentRoutes = express.Router();

departmentRoutes.use(protectRoute);

departmentRoutes.get("/", getDepartment);
departmentRoutes.get("/:id", isAdministrator, getDepartmentById);

departmentRoutes.post(
  "/",
  isAdministrator,
  createDepartment
);

departmentRoutes.put(
  "/:id",
  isAdministrator,
  updateDepartment
);

departmentRoutes.delete("/:id", isAdministrator, deleteDepartment);

export default departmentRoutes;