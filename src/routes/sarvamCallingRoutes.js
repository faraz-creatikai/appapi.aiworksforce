import express from "express";
import { protectRoute } from "../middlewares/auth.js";
import { sarvamCallWebhook, triggerSarvamCall } from "../controllers/sarvamCallingController.js";


const sarvamCallingRoutes = express.Router();

sarvamCallingRoutes.post('/sarvamCallWebhook', sarvamCallWebhook);
sarvamCallingRoutes.post("/triggerCall",protectRoute,triggerSarvamCall);

export default sarvamCallingRoutes;