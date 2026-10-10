import express from "express";
import { protectRoute } from "../middlewares/auth.js";
import { getSarvamCallReport, sarvamAuthDiagnose, sarvamCallWebhook,  streamSarvamAudio, syncSarvamCallLogs, triggerSarvamCall } from "../controllers/sarvamCallingController.js";
import { createCallingConfig, deleteCallingConfig, getCallingConfigs, setActiveConfig, updateCallingConfig } from "../controllers/callingAgentConfigController.js";


const sarvamCallingRoutes = express.Router();

sarvamCallingRoutes.post('/sarvamCallWebhook', sarvamCallWebhook);
sarvamCallingRoutes.post("/triggerCall",protectRoute,triggerSarvamCall);
sarvamCallingRoutes.get("/sync-call-logs", syncSarvamCallLogs);
sarvamCallingRoutes.get("/audio", protectRoute, streamSarvamAudio);

/* sarvamCallingRoutes.post('/ttsTest', sarvamTtsTest); */
sarvamCallingRoutes.get('/authDiagnose', sarvamAuthDiagnose);

sarvamCallingRoutes.get("/call-report", protectRoute, getSarvamCallReport);

// New CallingAgentConfig CRUD Routes (Protected)
sarvamCallingRoutes.get('/config', protectRoute, getCallingConfigs);
sarvamCallingRoutes.post('/config', protectRoute, createCallingConfig);
sarvamCallingRoutes.put('/config/:id', protectRoute, updateCallingConfig);
sarvamCallingRoutes.delete('/config/:id', protectRoute, deleteCallingConfig);
sarvamCallingRoutes.patch('/config/:id/active', protectRoute, setActiveConfig);

export default sarvamCallingRoutes;