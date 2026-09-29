
import express from "express";
import { generateVideoScript, renderVideo, uploadPhotos } from "../controllers/controller.videoProject.js";
import upload, { voiceUpload } from "../config/multer.js";
import { protectRoute } from "../middlewares/auth.js";


const videoProjectRoutes = express.Router();
videoProjectRoutes.use(protectRoute);

videoProjectRoutes.post("/photos", upload.array("photos"), uploadPhotos);       // Step 1: upload property photos
videoProjectRoutes.post("/script", generateVideoScript);                          // Step 3: AI script generation
videoProjectRoutes.post("/render", voiceUpload.single("uploadedVoiceover"), renderVideo); // Step 5: render final video

export default videoProjectRoutes;

