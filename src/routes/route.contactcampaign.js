import express from "express";
import {
  createContactCampaign,
  deleteContactCampaign,
  getContactCampaign,
  getContactCampaignById,
  updateContactCampaign,
} from "../controllers/controller.contactcampaign.js";

import { validate } from "../middlewares/validate.js";
import {
  createContactCampaignValidator,
  updateContactCampaignValidator,
} from "../validators/contactcampaignvalidator.js";
import {
  isAdministrator,
  isCityAdminOrAbove,
  protectRoute,
} from "../middlewares/auth.js";

const contactCampaignRoutes = express.Router();

contactCampaignRoutes.use(protectRoute);

contactCampaignRoutes.get("/", getContactCampaign);
contactCampaignRoutes.get("/:id", isAdministrator, getContactCampaignById);
contactCampaignRoutes.post(
  "/",
  isAdministrator,
  validate(createContactCampaignValidator),
  createContactCampaign
);
contactCampaignRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateContactCampaignValidator),
  updateContactCampaign
);
contactCampaignRoutes.delete("/:id", isAdministrator, deleteContactCampaign);

export default contactCampaignRoutes;
