import express from "express";

import { validate } from "../middlewares/validate.js";
import { isAdministrator, protectCustomerRoute, protectEmployeeRoute, protectRoute } from "../middlewares/auth.js";
import { createAIAgentValidator, updateAIAgentValidator } from "../validators/aiagentValidator.js";
import { assignAIAgent, compareProductPrice, createAIAgent, deleteAIAgent, deleteSession, getAIAgentById, getAIAgents, getChatSessions, getDailyAIReports, getSessionMessages, handleAiChat, runWebhookAgent, toggleSessionPin, updateAIAgent } from "../controllers/controller.aiagent.js";

const aiAgentRoutes = express.Router();

// 🚨 BUG FIXED: Removed the global aiAgentRoutes.use(protectRoute);
// It was forcing admin checks on customer/employee routes.

// ==========================================
// SYSTEM & MANAGEMENT ROUTES (Admin Only)
// ==========================================

// GET ALL AGENTS
aiAgentRoutes.get("/", protectRoute, getAIAgents);

// 24/7 ai agent route
aiAgentRoutes.get('/ai-reports', protectRoute, getDailyAIReports);

// GET SINGLE AGENT
aiAgentRoutes.get("/:id", protectRoute, isAdministrator, getAIAgentById);

// CREATE AGENT
aiAgentRoutes.post(
  "/",
  protectRoute,
  isAdministrator,
  validate(createAIAgentValidator),
  createAIAgent
);

// UPDATE AGENT
aiAgentRoutes.put(
  "/:id",
  protectRoute,
  isAdministrator,
  validate(updateAIAgentValidator),
  updateAIAgent
);

// ASSIGN AGENT
aiAgentRoutes.post("/assign", protectRoute, assignAIAgent);

// DELETE AGENT
aiAgentRoutes.delete("/:id", protectRoute, isAdministrator, deleteAIAgent);

aiAgentRoutes.post("/run-webhook-agent", protectRoute, runWebhookAgent);
aiAgentRoutes.post("/compare-product-price", protectRoute, compareProductPrice);


// ==========================================
// ADMIN AGENT CHAT ROUTES
// ==========================================
aiAgentRoutes.post("/admin/message", protectRoute, handleAiChat);
aiAgentRoutes.get("/admin/sessions", protectRoute, getChatSessions);
aiAgentRoutes.get("/admin/sessions/:sessionId/messages", protectRoute, getSessionMessages);
aiAgentRoutes.patch("/admin/sessions/:sessionId/pin", protectRoute, toggleSessionPin);
aiAgentRoutes.delete("/admin/sessions/:sessionId", protectRoute, deleteSession);

// ==========================================
// EMPLOYEE AGENT CHAT ROUTES
// ==========================================
aiAgentRoutes.post("/employee/message", protectEmployeeRoute, handleAiChat);
aiAgentRoutes.get("/employee/sessions", protectEmployeeRoute, getChatSessions);
aiAgentRoutes.get("/employee/sessions/:sessionId/messages", protectEmployeeRoute, getSessionMessages);
aiAgentRoutes.patch("/employee/sessions/:sessionId/pin", protectEmployeeRoute, toggleSessionPin);
aiAgentRoutes.delete("/employee/sessions/:sessionId", protectEmployeeRoute, deleteSession);

// ==========================================
// CUSTOMER AGENT CHAT ROUTES
// ==========================================
aiAgentRoutes.post("/customer/message", protectCustomerRoute, handleAiChat);
aiAgentRoutes.get("/customer/sessions", protectCustomerRoute, getChatSessions);
aiAgentRoutes.get("/customer/sessions/:sessionId/messages", protectCustomerRoute, getSessionMessages);
aiAgentRoutes.patch("/customer/sessions/:sessionId/pin", protectCustomerRoute, toggleSessionPin);
aiAgentRoutes.delete("/customer/sessions/:sessionId", protectCustomerRoute, deleteSession);

export default aiAgentRoutes;