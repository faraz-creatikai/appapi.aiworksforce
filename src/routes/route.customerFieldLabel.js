import express from "express";


import { protectRoute } from "../middlewares/auth.js";
import { isCityAdminOrAbove } from "../middlewares/auth.js";
import { getCustomerFieldLabels, updateCustomerFieldLabels } from "../controllers/controller.customerFieldLabel.js";

const customerFieldLabelRoutes = express.Router();

// Protected Routes
customerFieldLabelRoutes.use(protectRoute);

// ------------------------------------------------------
// GET → Used by frontend (forms, tables)
// ------------------------------------------------------
customerFieldLabelRoutes.get("/", getCustomerFieldLabels);

// ------------------------------------------------------
// PATCH → Admin edits labels (bulk update)
// ------------------------------------------------------
customerFieldLabelRoutes.patch(
  "/",
  isCityAdminOrAbove,
  updateCustomerFieldLabels
);

export default customerFieldLabelRoutes;
