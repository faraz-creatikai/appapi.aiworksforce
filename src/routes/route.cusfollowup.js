import express from "express";
import {
  createFollowup,
  getFollowups,
  getFollowupByCustomer,
  deleteFollowup,
  getFollowupById,
  updateFollowup,
  deleteFollowupsByCustomer,
  createFollowupByAI,
} from "../controllers/controller.cusfollowup.js";
import { protectRoute } from "../middlewares/auth.js";

const followupRoutes = express.Router();

followupRoutes.use(protectRoute)

followupRoutes.post("/aifollowup", createFollowupByAI);


// Create follow-up for a specific customer
followupRoutes.post("/:customerId", createFollowup);


// Get all follow-ups with pagination
followupRoutes.get("/",protectRoute, getFollowups);

// Get all follow-ups of one customer
followupRoutes.get("/customer/:customerId", getFollowupByCustomer);

//get follow up by id
followupRoutes.get("/:id", getFollowupById);

//update followup
followupRoutes.put("/:id", updateFollowup);

// Delete one follow-up
followupRoutes.delete("/:id", deleteFollowup);

// Delete all follow-ups
followupRoutes.delete("/customer/:customerId", deleteFollowupsByCustomer);

export default followupRoutes;
