import express from "express";
import { isCityAdminOrAbove, protectEmployeeRoute, protectRoute } from "../middlewares/auth.js"; // Your Admin Auth


import {
  createAdminTask,
  getAdminTasks,
  updateAdminTask,
  deleteAdminTask,
  getEmployeeTasks,
  updateEmployeeTaskStatus,
  createSubTask,
  toggleSubTask,
  deleteSubTask,
  generateSubtasksAI,
  assignTaskViaAI,
  updateSubTaskStatus,
  submitTaskForMacroReview,
  verifySubTask
} from "../controllers/controller.task.js";

const taskRoutes = express.Router();

// ==========================================
// 🏢 ADMIN ROUTES (CRM Portal)
// ==========================================
// Uses protectRoute & isCityAdminOrAbove
taskRoutes.post("/admin", protectRoute, isCityAdminOrAbove, createAdminTask);
taskRoutes.get("/admin", protectRoute, isCityAdminOrAbove, getAdminTasks);
taskRoutes.put("/admin/:id", protectRoute, isCityAdminOrAbove, updateAdminTask);
taskRoutes.delete("/admin", protectRoute, isCityAdminOrAbove, deleteAdminTask); // Expects { taskIds: [...] }
taskRoutes.post("/admin/ai/generate-subtasks", protectRoute, generateSubtasksAI);
taskRoutes.post("/admin/ai/assign", protectRoute, assignTaskViaAI);


// ==========================================
// 🧑‍💻 EMPLOYEE ROUTES (Staff Workspace)
// ==========================================
// Uses protectEmployeeRoute

// Main Tasks
taskRoutes.get("/employee", protectEmployeeRoute, getEmployeeTasks);
taskRoutes.put("/employee/:id/status", protectEmployeeRoute, updateEmployeeTaskStatus);
taskRoutes.put("/employee/subtask/:id/status", protectEmployeeRoute,  updateSubTaskStatus);

// Subtasks
taskRoutes.post("/employee/subtask", protectEmployeeRoute, createSubTask);
taskRoutes.put("/employee/subtask/:id", protectEmployeeRoute, toggleSubTask);
taskRoutes.delete("/employee/subtask/:id", protectEmployeeRoute, deleteSubTask);

taskRoutes.put("/employee/:id/submit-review", protectEmployeeRoute, submitTaskForMacroReview);
taskRoutes.put("/employee/subtask/:id/verify", protectEmployeeRoute, verifySubTask);

export default taskRoutes;