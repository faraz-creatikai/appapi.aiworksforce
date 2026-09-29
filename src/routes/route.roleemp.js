import express from "express";


import { isAdministrator, protectRoute } from "../middlewares/auth.js";
import { createRoleEmp, deleteRoleEmp, deleteRoleEmpbyId, getRoleEmp, getRoleEmpById, updateRoleEmp } from "../controllers/controller.roleemp.js";

const roleEmpRoutes = express.Router();

roleEmpRoutes.use(protectRoute);

// ✅ Get all or filtered roleEmps
roleEmpRoutes.get("/", getRoleEmp);

// ✅ Get roleEmps by department and/or designation
roleEmpRoutes.get(
  "/filter/:departmentId/:designationId?",
  async (req, res, next) => {
    req.query.departmentId = req.params.departmentId;
    if (req.params.designationId) req.query.designationId = req.params.designationId;
    next(); // reuse getroleEmp logic
  },
  getRoleEmp
);

roleEmpRoutes.get("/:id", isAdministrator, getRoleEmpById);

roleEmpRoutes.post(
  "/",
  isAdministrator,
  createRoleEmp
);

roleEmpRoutes.put(
  "/:id",
  isAdministrator,
  updateRoleEmp
);

roleEmpRoutes.delete("/", isAdministrator, deleteRoleEmp);
roleEmpRoutes.delete("/:id", isAdministrator, deleteRoleEmpbyId);

export default roleEmpRoutes;