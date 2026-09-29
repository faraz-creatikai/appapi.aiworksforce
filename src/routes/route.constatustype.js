import express from "express";
import {
  createStatustype,
  deleteStatustype,
  getStatustype,
  getStatustypeById,
  updateStatustype,
} from "../controllers/controller.constatusType.js";

import { validate } from "../middlewares/validate.js";
import {
  createStatustypeValidator,
  updateStatustypeValidator,
} from "../validators/statustypevalidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const constatustypeRoutes = express.Router();

constatustypeRoutes.use(protectRoute);

constatustypeRoutes.get("/", getStatustype);
constatustypeRoutes.get("/:id", isAdministrator, getStatustypeById);
constatustypeRoutes.post(
  "/",
  isAdministrator,
  validate(createStatustypeValidator),
  createStatustype
);
constatustypeRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateStatustypeValidator),
  updateStatustype
);
constatustypeRoutes.delete("/:id", isAdministrator, deleteStatustype);

export default constatustypeRoutes;
