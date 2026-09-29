import express from "express";
import {
  makeCall,
  handleExotelWebhook,
  getAllCalls,
} from "../controllers/controller.calls.js";

const callRoutes = express.Router();

callRoutes.post("/make", makeCall);
callRoutes.post("/webhook", handleExotelWebhook); // Exotel sends updates here
callRoutes.get("/", getAllCalls); // Get all logged calls

export default callRoutes;
