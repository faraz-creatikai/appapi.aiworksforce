import express from "express";
import {
  createConFollowup,
  getConFollowups,
  getConFollowupByContact,
  getConFollowupById,
  updateConFollowup,
  deleteConFollowup,
  deleteAllConFollowups,
} from "../controllers/controller.confollowup.js";

const confollowupRoutes = express.Router();

// ✅ Create follow-up for a specific contact
confollowupRoutes.post("/:contactId", createConFollowup);

// ✅ Get all follow-ups (with pagination and filters)
confollowupRoutes.get("/", getConFollowups);

// ✅ Get all follow-ups for one specific contact
confollowupRoutes.get("/contact/:contactId", getConFollowupByContact);

// ✅ Get a single follow-up by ID
confollowupRoutes.get("/:id", getConFollowupById);

// ✅ Update a specific follow-up
confollowupRoutes.put("/:id", updateConFollowup);

// ✅ Delete a specific follow-up
confollowupRoutes.delete("/:id", deleteConFollowup);

// ✅ Delete all follow-ups
confollowupRoutes.delete("/", deleteAllConFollowups);

export default confollowupRoutes;
