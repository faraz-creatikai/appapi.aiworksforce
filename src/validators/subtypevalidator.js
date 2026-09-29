import { body } from "express-validator";

// ✅ Validator for creating a new SubType
export const createSubTypeValidator = [
  body("Campaign")
    .optional()
    .isString()
    .withMessage("Campaign must be a string"),

  body("CustomerType")
    .optional()
    .isString()
    .withMessage("CustomerType must be a string"),

  body("Name").optional().isString().withMessage("Name must be a string"),

  body("Status")
    .optional()
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];

// ✅ Validator for updating an existing SubType
export const updateSubTypeValidator = [
  body("Campaign")
    .optional()
    .isString()
    .withMessage("Campaign must be a string"),

  body("CustomerType")
    .optional()
    .isString()
    .withMessage("CustomerType must be a string"),

  body("Name").optional().isString().withMessage("Name must be a string"),

  body("Status")
    .optional()
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];
