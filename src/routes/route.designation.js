import express from "express";
import {
  createDesignation,
  deleteDesignation,
  deleteDesignationbyId,
  getDesignation,
  getDesignationById,
  updateDesignation,
} from "../controllers/controller.designation.js";

import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const designationRoutes = express.Router();

designationRoutes.use(protectRoute);

// ✅ Get all or filtered designations
designationRoutes.get("/", getDesignation);

// ✅ Get designations by department (for dependent dropdowns)
designationRoutes.get(
  "/department/:departmentId",
  async (req, res, next) => {
    req.query.departmentId = req.params.departmentId;
    next(); // reuse getDesignation logic
  },
  getDesignation
);

designationRoutes.get("/:id", isAdministrator, getDesignationById);

designationRoutes.post(
  "/",
  isAdministrator,
  createDesignation
);

designationRoutes.put(
  "/:id",
  isAdministrator,
  updateDesignation
);

designationRoutes.delete("/", isAdministrator, deleteDesignation);
designationRoutes.delete("/:id", isAdministrator, deleteDesignationbyId);

export default designationRoutes;