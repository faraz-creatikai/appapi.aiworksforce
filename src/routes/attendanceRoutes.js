import express from "express";
import { adminUpdateAttendance, checkEmployeeAuth, clockIn, clockOut, createEmployee, deleteEmployees, employeeLogin, employeeLogout, employeeManualUpdate, getAdminAttendanceReport, getAttendanceOverview, getAttendanceTrend, getEmployeeAttendanceReport, getEmployeeById, getEmployees, updateEmployee } from "../controllers/attendance.controller.js";
import { protectEmployeeRoute, protectRoute } from "../middlewares/auth.js";
import { getCustomerById } from "../controllers/controller.customer.js";
import upload from "../config/multer.js";





const attendanceRoutes = express.Router();

// ==========================================
// EMPLOYEE AUTHENTICATION
// ==========================================
// Note: Frontend uses this to log the employee (customer) into their separate panel
attendanceRoutes.post("/employee/login", employeeLogin);
attendanceRoutes.get("/employee/check",protectEmployeeRoute, checkEmployeeAuth);
attendanceRoutes.post("/employee/logout", employeeLogout);


// ==========================================
// EMPLOYEE ATTENDANCE ROUTES
// ==========================================
// These routes are strictly protected for the logged-in employee only
attendanceRoutes.post("/employee/clock-in", protectEmployeeRoute, clockIn);
attendanceRoutes.post("/employee/clock-out", protectEmployeeRoute, clockOut);
attendanceRoutes.get("/employee/report", protectEmployeeRoute, getEmployeeAttendanceReport);
attendanceRoutes.post("/employee/manual-update", protectEmployeeRoute, employeeManualUpdate);
attendanceRoutes.get("/employee/:id",protectEmployeeRoute, getEmployeeById);

// GET all employees
attendanceRoutes.get("/employee", protectRoute, getEmployees);


// CREATE employee
attendanceRoutes.post(
  "/employee",
  protectRoute,
  upload.fields([{ name: "EmployeeImage", maxCount: 5 }]),
  createEmployee
);

// UPDATE employee
attendanceRoutes.put(
  "/employee/:id",
  protectRoute,
  upload.fields([{ name: "EmployeeImage", maxCount: 5 }]),
  updateEmployee
);

// DELETE multiple/all employees
attendanceRoutes.delete("/employee", protectRoute, deleteEmployees);




// ==========================================
// ADMIN ATTENDANCE ROUTES
// ==========================================
// These routes are strictly protected by your existing Admin CRM authentication
attendanceRoutes.post("/admin/update", protectRoute, adminUpdateAttendance);
attendanceRoutes.get("/admin/report", protectRoute, getAdminAttendanceReport);

attendanceRoutes.get("/trend", protectRoute, getAttendanceTrend);
attendanceRoutes.get("/overview", protectRoute, getAttendanceOverview);



export default attendanceRoutes;