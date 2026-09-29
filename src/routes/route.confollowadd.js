import express from "express";
import {
  createConFollowup,
  getConFollowups,
  getConFollowupByContact,
  getConFollowupById,
  updateConFollowup,
  deleteConFollowup,
  deleteConFollowupsByContact,
} from "../controllers/controller.confollow.js";
import { protectRoute } from "../middlewares/auth.js";

const confollowaddRoutes = express.Router();

// ✅ Create follow-up for a specific contact
confollowaddRoutes.post("/:contactId", createConFollowup);

// ✅ Get all follow-ups (with pagination and filters)
confollowaddRoutes.get("/",protectRoute, getConFollowups);

// ✅ Get all follow-ups for one specific contact
confollowaddRoutes.get("/contact/:contactId", getConFollowupByContact);

// ✅ Get a single follow-up by ID
confollowaddRoutes.get("/:id", getConFollowupById);

// ✅ Update a specific follow-up
confollowaddRoutes.put("/:id", updateConFollowup);

// ✅ Delete a specific follow-up
confollowaddRoutes.delete("/:id", deleteConFollowup);

// ✅ Delete all follow-ups
confollowaddRoutes.delete("/contact/:contactId", deleteConFollowupsByContact);

export default confollowaddRoutes;
