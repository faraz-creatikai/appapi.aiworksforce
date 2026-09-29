import express from "express";
import {
  userLogin,
  userSignup,
  checkAuth,
  updateUSer,
} from "../controllers/controller.user.js";

import { validate } from "../middlewares/validate.js";
import {
  loginValidator,
  signupValidator,
  updateUserValidator,
} from "../validators/userValidator.js";

const userRoutes = express.Router();

userRoutes.get("/check", checkAuth);
userRoutes.post("/login", validate(loginValidator), userLogin);
userRoutes.post("/signup", validate(signupValidator), userSignup);
userRoutes.put("/update", validate(updateUserValidator), updateUSer);

export default userRoutes;
