import express from "express";


import { validate } from "../middlewares/validate.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";
import { createSalesScript, deleteSalesScript, getSalesScript, getSalesScriptById, updateSalesScript } from "../controllers/controller.salesscript.js";
import { createSalesScriptValidator, updateSalesScriptValidator } from "../validators/salesscriptValidator.js";

const salesScriptRoutes = express.Router();

salesScriptRoutes.use(protectRoute);

salesScriptRoutes.get("/", getSalesScript);
salesScriptRoutes.get("/:id", isAdministrator, getSalesScriptById);
salesScriptRoutes.post(
  "/",
  isAdministrator,
  validate(createSalesScriptValidator),
  createSalesScript
);
salesScriptRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateSalesScriptValidator),
  updateSalesScript
);
salesScriptRoutes.delete("/:id", isAdministrator, deleteSalesScript);

export default salesScriptRoutes;
