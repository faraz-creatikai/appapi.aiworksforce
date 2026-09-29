import express from "express";
import {
  createContactAdv,
  deleteContactAdv,
  getContactAdv,
  getContactAdvById,
  updateContactAdv,
} from "../controllers/controller.contactAdv.js";

import { validate } from "../middlewares/validate.js";
import {
  createContactAdvValidator,
  updateContactAdvValidator,
} from "../validators/contactAdvvalidator.js";

const contactAdvRoutes = express.Router();

contactAdvRoutes.get("/", getContactAdv);
contactAdvRoutes.get("/:id", getContactAdvById);
contactAdvRoutes.post(
  "/",
  validate(createContactAdvValidator),
  createContactAdv
);
contactAdvRoutes.put(
  "/:id",
  validate(updateContactAdvValidator),
  updateContactAdv
);
contactAdvRoutes.delete("/:id", deleteContactAdv);

export default contactAdvRoutes;
