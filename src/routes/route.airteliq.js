import express from "express";

import { makeAirtelCall } from "../controllers/controller.airteliq.js";

const airteliqCallRoutes = express.Router();

airteliqCallRoutes.post("/make-call", makeAirtelCall);
 // Get all logged calls

export default airteliqCallRoutes;