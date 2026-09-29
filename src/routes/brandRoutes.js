import express from "express";

import {
  getBrandSettings,
  updateBrandSettings,
} from "../controllers/brandController.js";
import { protectRoute } from "../middlewares/auth.js";
import { brandUpload } from "../config/multer.js";

const brandRoutes = express.Router();

// Public route for Login Page, PWA Manifest, and Initial App Load
brandRoutes.get("/get", getBrandSettings);

// Protected Admin route for updating branding assets
brandRoutes.put(
  "/update",
  protectRoute,
  brandUpload.fields([
    { name: "favicon", maxCount: 1 },
    { name: "logoSingle", maxCount: 1 },
    { name: "logoText", maxCount: 1 },
    { name: "splashScreen", maxCount: 1 },
    { name: "icon192", maxCount: 1 },
    { name: "icon512", maxCount: 1 },
  ]),
  updateBrandSettings
);

export default brandRoutes;