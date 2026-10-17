import express from "express";
import { protectRoute } from "../middlewares/auth.js";
import { createPost, disconnectAccount, getAccountStatus, getAuthUrl, getLinkedinPosts, handleOAuthCallback } from "../controllers/controller.linkdin.js";
import upload from "../config/multer.js";




const linkedinRoutes = express.Router();

// ==========================================
// 🏢 ADMIN ROUTES (CRM Portal)
// ==========================================

// 1. Get the OAuth URL to redirect the user to LinkedIn
linkedinRoutes.get("/auth-url", protectRoute, getAuthUrl);

// 2. Receive the code from the frontend and process the tokens
linkedinRoutes.post("/callback", protectRoute, handleOAuthCallback);

// 3. Check if the current admin has a linked account
linkedinRoutes.get("/status", protectRoute, getAccountStatus);

// 4. Disconnect/Delete the account
linkedinRoutes.delete("/disconnect", protectRoute, disconnectAccount);

linkedinRoutes.post("/publish", protectRoute, upload.single("media"), createPost);

// Don't forget to import getLinkedinPosts at the top!
linkedinRoutes.get("/posts", protectRoute, getLinkedinPosts);

export default linkedinRoutes;