import express from "express";
import { validate } from "../middlewares/validate.js";
import {
  loginValidator,
  signupValidator,
  updateUserValidator,
  userSignupValidator,
} from "../validators/userValidator.js";

import { acceptRequest, denyRequest, getAllRequestUser, newUserSignup } from "../controllers/requestUserController.js";
import { isCityAdminOrAbove, protectRoute } from "../middlewares/auth.js";
import upload from "../config/multer.js";

const requestUserRoutes = express.Router();

requestUserRoutes.post("/newusersignup", upload.fields([
  { name: "AdminImage", maxCount: 5 },
]), validate(userSignupValidator), newUserSignup);
requestUserRoutes.post("/newusers/:id", protectRoute, isCityAdminOrAbove, acceptRequest);
requestUserRoutes.get("/newusers", protectRoute, getAllRequestUser);
requestUserRoutes.delete("/newusers/:id", protectRoute, isCityAdminOrAbove, denyRequest);



export default requestUserRoutes;