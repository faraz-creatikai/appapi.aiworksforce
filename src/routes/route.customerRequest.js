import express from "express";
import { isCityAdminOrAbove, protectRoute } from "../middlewares/auth.js"; // Your Admin Auth

import {
  createCustomerRequest,
  getCustomerRequests,
  approveCustomerRequest,
  denyCustomerRequest,
} from "../controllers/controller.customerRequest.js";

const customerRequestRoutes = express.Router();

// ==========================================
// 🌐 PUBLIC ROUTE (No auth middleware)
// ==========================================
customerRequestRoutes.post("/public/request", createCustomerRequest);


// ==========================================
// 🏢 ADMIN ROUTES (CRM Portal)
// ==========================================
// Uses protectRoute & isCityAdminOrAbove

// Get all requests (e.g., GET /admin?status=pending)
customerRequestRoutes.get("/admin", protectRoute, isCityAdminOrAbove, getCustomerRequests);

// Approve request (converts to real customer)
customerRequestRoutes.put("/admin/:id/approve", protectRoute, isCityAdminOrAbove, approveCustomerRequest);

// Deny request
customerRequestRoutes.put("/admin/:id/deny", protectRoute, isCityAdminOrAbove, denyCustomerRequest);

export default customerRequestRoutes;