import { body } from "express-validator";

// ✅ Validator for creating a new campaign
export const createRoleValidator = [
  body("Role").optional().isString().withMessage("Role must be a string"),

  body("Slug").optional().isString().withMessage("Slug must be a string"),

  body("Status")
    .optional()
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];

// ✅ Validator for updating an existing campaign
export const updateRoleValidator = [
  body("Role").optional().isString().withMessage("Role must be a string"),

  body("Slug").optional().isString().withMessage("Slug must be a string"),

  body("Status")
    .optional()
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];
