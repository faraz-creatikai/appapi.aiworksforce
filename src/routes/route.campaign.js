import express from "express";
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  getCampaignById,
  updateCampaign,
} from "../controllers/controller.campaign.js";

import { validate } from "../middlewares/validate.js";
import {
  createCampaignValidator,
  updateCampaignValidator,
} from "../validators/campaignvalidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const campaignRoutes = express.Router();

campaignRoutes.use(protectRoute);

campaignRoutes.get("/", getCampaign);
campaignRoutes.get("/:id", isAdministrator, getCampaignById);
campaignRoutes.post(
  "/",
  isAdministrator,
  validate(createCampaignValidator),
  createCampaign
);
campaignRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateCampaignValidator),
  updateCampaign
);
campaignRoutes.delete("/:id", isAdministrator, deleteCampaign);

export default campaignRoutes;
