import express from "express";
import { protectRoute } from "../middlewares/auth.js";
import {  getAgentVoices, getCurrentAgent, updateCallingAgent } from "../controllers/controller.tabbly.js";


const tabblyRoutes = express.Router();

tabblyRoutes.use(protectRoute);

tabblyRoutes.get("/current-agent",getCurrentAgent);
tabblyRoutes.get("/agent-voices",getAgentVoices);
tabblyRoutes.put("/update-agent",updateCallingAgent);

export default tabblyRoutes;