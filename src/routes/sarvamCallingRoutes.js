import express from "express";
import { protectRoute } from "../middlewares/auth.js";
import { sarvamAuthDiagnose, sarvamCallWebhook,  streamSarvamAudio, syncSarvamCallLogs, triggerSarvamCall } from "../controllers/sarvamCallingController.js";


const sarvamCallingRoutes = express.Router();

sarvamCallingRoutes.post('/sarvamCallWebhook', sarvamCallWebhook);
sarvamCallingRoutes.post("/triggerCall",protectRoute,triggerSarvamCall);
sarvamCallingRoutes.get("/sync-call-logs", syncSarvamCallLogs);
sarvamCallingRoutes.get("/audio", protectRoute, streamSarvamAudio);

/* sarvamCallingRoutes.post('/ttsTest', sarvamTtsTest); */
sarvamCallingRoutes.get('/authDiagnose', sarvamAuthDiagnose);

export default sarvamCallingRoutes;