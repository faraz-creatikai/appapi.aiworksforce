import express from "express";
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  getScheduleById,
  updateSchedule,
} from "../controllers/controller.schedules.js";

import { validate } from "../middlewares/validate.js";
import {
  createScheduleValidator,
  updateScheduleValidator,
} from "../validators/schedulevalidator.js";
import { isCityAdminOrAbove, protectRoute } from "../middlewares/auth.js";

const scheduleRoutes = express.Router();
scheduleRoutes.use(protectRoute);

scheduleRoutes.get("/", getSchedule);
scheduleRoutes.get("/:id", isCityAdminOrAbove, getScheduleById);
scheduleRoutes.post(
  "/",
  validate(createScheduleValidator),
  isCityAdminOrAbove,
  createSchedule
);
scheduleRoutes.put(
  "/:id",
  validate(updateScheduleValidator),
  isCityAdminOrAbove,
  updateSchedule
);
scheduleRoutes.delete("/", isCityAdminOrAbove, deleteSchedule);

export default scheduleRoutes;
