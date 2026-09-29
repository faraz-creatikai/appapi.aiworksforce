import express from "express";
import {
  createReference,
  deleteReference,
  getReference,
  getReferenceById,
  updateReference,
} from "../controllers/controller.references.js";

import { validate } from "../middlewares/validate.js";
import {
  createReferenceValidator,
  updateReferenceValidator,
} from "../validators/referencesvalidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const referenceRoutes = express.Router();

referenceRoutes.use(protectRoute);

referenceRoutes.get("/", getReference);
referenceRoutes.get("/:id", isAdministrator, getReferenceById);
referenceRoutes.post(
  "/",
  isAdministrator,
  validate(createReferenceValidator),
  createReference
);
referenceRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateReferenceValidator),
  updateReference
);
referenceRoutes.delete("/:id", isAdministrator, deleteReference);

export default referenceRoutes;
