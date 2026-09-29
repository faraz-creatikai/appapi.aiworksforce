import express from "express";


import { validate } from "../middlewares/validate.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";
import { createLeadType, deleteLeadType, getLeadType, getLeadTypeById, updateLeadType } from "../controllers/controller.leadtype.js";
import { createLeadTypeValidator, updateLeadTypeValidator } from "../validators/leadtypeValidator.js";

const leadtypeRoutes = express.Router();

leadtypeRoutes.use(protectRoute);

leadtypeRoutes.get("/", getLeadType);
leadtypeRoutes.get("/:id", isAdministrator, getLeadTypeById);
leadtypeRoutes.post(
  "/",
  isAdministrator,
  validate(createLeadTypeValidator),
  createLeadType
);
leadtypeRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateLeadTypeValidator),
  updateLeadType
);
leadtypeRoutes.delete("/:id", isAdministrator, deleteLeadType);

export default leadtypeRoutes;
