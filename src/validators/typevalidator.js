import { body } from "express-validator";

// ✅ Validator for creating a new Type
export const createTypeValidator = [
  body("Campaign")
    .optional()
    .isString()
    .withMessage("Campaign must be a string"),

  body("Name").optional().isString().withMessage("Name must be a string"),

  body("Status")
    .optional()
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];

// ✅ Validator for updating an existing Type
export const updateTypeValidator = [
  body("Campaign")
    .optional()
    .isString()
    .withMessage("Campaign must be a string"),

  body("Name").optional().isString().withMessage("Name must be a string"),

  body("Status")
    .optional()
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];
