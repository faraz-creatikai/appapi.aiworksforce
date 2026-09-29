
import express from "express";
import { requireActivityAccess } from "../utils/activityLogger.js";
import {
  getActivityFeed,
  getActivitySummary,
  getUserTimeline,
  getActivityUsers,
  getTouchedCustomers,
  getTouchedFollowups,
  getRecordDetail,
} from "../controllers/activity.controller.js";
import { protectRoute } from "../middlewares/auth.js";

const activityRoutes = express.Router();

activityRoutes.use(protectRoute, requireActivityAccess);

activityRoutes.get("/feed", getActivityFeed);
activityRoutes.get("/summary", getActivitySummary);
activityRoutes.get("/users", getActivityUsers);
activityRoutes.get("/timeline/:adminId", getUserTimeline);


activityRoutes.get("/customers", getTouchedCustomers);
activityRoutes.get("/followups", getTouchedFollowups);
activityRoutes.get("/record/:entity/:id", getRecordDetail);

export default activityRoutes;

// in app.js:  app.use("/api/activity", activityRoutes);