import express from "express";
import {
  createContactType,
  deleteContactType,
  getContactType,
  getContactTypeByCampaign,
  getContactTypeById,
  updateContactType,
} from "../controllers/controller.contactType.js";

import { validate } from "../middlewares/validate.js";
import {
  createContactTypeValidator,
  updateContactTypeValidator,
} from "../validators/contacttypevalidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const contactTypeRoutes = express.Router();
contactTypeRoutes.use(protectRoute);

contactTypeRoutes.get(
  "/campaign/:campaignId",
  protectRoute,
  getContactTypeByCampaign
);
contactTypeRoutes.get("/", getContactType);
contactTypeRoutes.get("/:id", isAdministrator, getContactTypeById);
contactTypeRoutes.post(
  "/",
  isAdministrator,
  validate(createContactTypeValidator),
  createContactType
);
contactTypeRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateContactTypeValidator),
  updateContactType
);
contactTypeRoutes.delete("/:id", isAdministrator, deleteContactType);

export default contactTypeRoutes;
