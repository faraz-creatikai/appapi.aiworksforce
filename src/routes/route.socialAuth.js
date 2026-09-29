import express from "express";
import { protectRoute } from "../middlewares/auth.js";
import { disconnectFacebook, disconnectInstagram, getFacebookAnalytics, getFacebookLivePosts, getInstagramAnalytics, getInstagramLivePosts, getScheduledPosts, metaCallback, runAutoSocialAgent, scheduleFacebookPost, scheduleInstagramPost } from "../controllers/controller.socialAuth.js";
import upload from "../config/multer.js";

const socialAuthRoutes = express.Router();

socialAuthRoutes.use(protectRoute);




//saving mined leads 

socialAuthRoutes.get("/meta-callback", metaCallback);


//insta
socialAuthRoutes.get("/get-instagram-posts", getInstagramLivePosts);
socialAuthRoutes.get("/get-instagram-analytics", getInstagramAnalytics);
socialAuthRoutes.delete("/disconnect-instagram", disconnectInstagram);

socialAuthRoutes.post("/schedule-instagram-post", upload.fields([
    { name: "PostImage", maxCount: 5 },
]), scheduleInstagramPost)

socialAuthRoutes.get("/scheduled-posts-data", getScheduledPosts);


//facebook
socialAuthRoutes.get("/get-facebook-posts", getFacebookLivePosts);
socialAuthRoutes.get("/get-facebook-analytics", getFacebookAnalytics);
socialAuthRoutes.delete("/disconnect-facebook", disconnectFacebook);
socialAuthRoutes.post("/schedule-facebook-post", upload.fields([
    { name: "PostImage", maxCount: 5 },
]), scheduleFacebookPost)


socialAuthRoutes.post("/auto-social-agent", upload.fields([
    { name: "PostImage", maxCount: 5 },
]), runAutoSocialAgent);

export default socialAuthRoutes;