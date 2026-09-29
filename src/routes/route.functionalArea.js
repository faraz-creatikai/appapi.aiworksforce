import express from "express";
import {
  createFunctionalArea,
  deleteFunctionalArea,
  getFunctionalArea,
  getFunctionalAreaById,
  updateFunctionalArea,
} from "../controllers/controller.functionalArea.js";

import { validate } from "../middlewares/validate.js";
import {
  createFunctionalAreaValidator,
  updateFunctionalAreaValidator,
} from "../validators/functionalAreavalidator.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";

const functionalAreaRoutes = express.Router();

functionalAreaRoutes.use(protectRoute);

functionalAreaRoutes.get("/", getFunctionalArea);
functionalAreaRoutes.get("/:id", isAdministrator, getFunctionalAreaById);
functionalAreaRoutes.post(
  "/",
  isAdministrator,
  validate(createFunctionalAreaValidator),
  createFunctionalArea
);
functionalAreaRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateFunctionalAreaValidator),
  updateFunctionalArea
);
functionalAreaRoutes.delete("/:id", isAdministrator, deleteFunctionalArea);

export default functionalAreaRoutes;
