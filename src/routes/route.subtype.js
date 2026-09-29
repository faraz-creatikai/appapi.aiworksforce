import express from "express";
import {
  createSubType,
  deleteSubType,
  deleteSubTypebyId,
  getSubType,
  getSubTypeById,
  updateSubType,
} from "../controllers/controller.subtype.js";

import { validate } from "../middlewares/validate.js";
import {
  createSubTypeValidator,
  updateSubTypeValidator,
} from "../validators/subtypevalidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const subtypeRoutes = express.Router();

subtypeRoutes.use(protectRoute);

// ✅ Get all or filtered SubTypes
subtypeRoutes.get("/", getSubType);

// ✅ Get SubTypes by campaign and/or type
subtypeRoutes.get(
  "/filter/:campaignId/:typeId?",
  async (req, res, next) => {
    req.query.campaignId = req.params.campaignId;
    if (req.params.typeId) req.query.typeId = req.params.typeId;
    next(); // reuse getSubType logic
  },
  getSubType
);

subtypeRoutes.get("/:id", isAdministrator, getSubTypeById);
subtypeRoutes.post(
  "/",
  isAdministrator,
  validate(createSubTypeValidator),
  createSubType
);
subtypeRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateSubTypeValidator),
  updateSubType
);
subtypeRoutes.delete("/", isAdministrator, deleteSubType);
subtypeRoutes.delete("/:id", isAdministrator, deleteSubTypebyId);

export default subtypeRoutes;
