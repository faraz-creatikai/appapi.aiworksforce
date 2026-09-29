import express from "express";
import { createCustomerJson, importCustomersJson } from "../controllers/mcpController.js";

const mcpRoutes = express.Router();


mcpRoutes.post("/create/customer", createCustomerJson);
mcpRoutes.post("/import/json", importCustomersJson);

export default mcpRoutes;
