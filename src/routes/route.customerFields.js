import express from "express";


import { validate } from "../middlewares/validate.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";
import { createCustomerFields, deleteCustomerFields, getCustomerFields, getCustomerFieldsById, updateCustomerFields } from "../controllers/controller.customerFields.js";
import { createCustomerFieldsValidator, updateCustomerFieldsValidator } from "../validators/customerFieldsValidator.js";

const customerFieldsRoutes = express.Router();

customerFieldsRoutes.use(protectRoute);

customerFieldsRoutes.get("/", getCustomerFields);
customerFieldsRoutes.get("/:id", isAdministrator, getCustomerFieldsById);
customerFieldsRoutes.post(
  "/",
  isAdministrator,
  validate(createCustomerFieldsValidator),
  createCustomerFields
);
customerFieldsRoutes.put(
  "/:id",
  isAdministrator,
  validate(updateCustomerFieldsValidator),
  updateCustomerFields
);
customerFieldsRoutes.delete("/:id", isAdministrator, deleteCustomerFields);

export default customerFieldsRoutes;
