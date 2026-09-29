import { body } from "express-validator";

// ✅ Validator for creating a new campaign
export const createLocationValidator = [
  body("Name").optional().isString().withMessage("Name must be a string"),

  body("Status")
    .optional()
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];

// ✅ Validator for updating an existing campaign
export const updateLocationValidator = [
  body("Name").optional().isString().withMessage("Name must be a string"),

  body("City").optional().isString().withMessage("City must be a string"),

  body("Status")
    .optional()
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];
