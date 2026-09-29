import express from "express";
import { protectRoute } from "../middlewares/auth.js";
import { convertLeads, getFacebookPosts, getFacebookPostsByQuery, getInstagramPosts, getMinedLeads, getRedditPosts, saveMinedLeads, scrapeFacebookPosts, scrapeInstagramPosts } from "../controllers/controller.socialContent.js";

const socialContentRoutes = express.Router();

socialContentRoutes.use(protectRoute);

// Placeholder route for social content management
socialContentRoutes.post("/facebook/scrap-new",scrapeFacebookPosts);
socialContentRoutes.get("/reddit/:query", getRedditPosts);
socialContentRoutes.get("/facebook", getFacebookPosts);
socialContentRoutes.get("/facebook/:query", getFacebookPostsByQuery);

//instagram routes

socialContentRoutes.post("/instagram/scrap-new",scrapeInstagramPosts);
socialContentRoutes.get("/instagram", getInstagramPosts);


//saving mined leads 

socialContentRoutes.post("/minedlead/save",saveMinedLeads);
socialContentRoutes.get("/minedlead/get",getMinedLeads);
socialContentRoutes.post("/minedlead/convert",convertLeads);


export default socialContentRoutes;