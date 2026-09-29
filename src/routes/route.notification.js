import express from "express";



import { isAdministrator, protectRoute } from "../middlewares/auth.js";
import { getMyNotifications, markAllNotificationsRead, markNotificationRead } from "../controllers/notificationController.js";


const notificationRoutes = express.Router();

notificationRoutes.use(protectRoute);

notificationRoutes.get("/", getMyNotifications);
notificationRoutes.post("/mark-read/:id",markNotificationRead);
notificationRoutes.post("/mark-all-read",markAllNotificationsRead);



export default notificationRoutes;
