import express from "express";
import {
  createStatustype,
  deleteStatustype,
  getStatustype,
  getStatustypeById,
  updateStatustype,
} from "../controllers/controller.statustype.js";

import { validate } from "../middlewares/validate.js";
import {
  createStatustypeValidator,
  updateStatustypeValidator,
} from "../validators/statustypevalidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const statustypeRoutes = express.Router();

statustypeRoutes.use(protectRoute);

statustypeRoutes.get("/", getStatustype);
statustypeRoutes.get("/:id", isAdministrator, getStatustypeById);
statustypeRoutes.post(
  "/",
  isAdministrator,
  validate(createStatustypeValidator),
  createStatustype
);
statustypeRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateStatustypeValidator),
  updateStatustype
);
statustypeRoutes.delete("/:id", isAdministrator, deleteStatustype);

export default statustypeRoutes;
