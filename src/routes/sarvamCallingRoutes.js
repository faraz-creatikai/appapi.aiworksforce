import express from "express";
import { protectRoute } from "../middlewares/auth.js";
import { sarvamCallWebhook, sarvamTtsTest, triggerSarvamCall } from "../controllers/sarvamCallingController.js";


const sarvamCallingRoutes = express.Router();

sarvamCallingRoutes.post('/sarvamCallWebhook', sarvamCallWebhook);
sarvamCallingRoutes.post("/triggerCall",protectRoute,triggerSarvamCall);

sarvamCallingRoutes.post('/ttsTest', sarvamTtsTest);

export default sarvamCallingRoutes;