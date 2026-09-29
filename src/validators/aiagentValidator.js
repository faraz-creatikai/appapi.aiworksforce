import { body } from "express-validator";

// ✅ Validator for creating a new campaign
export const createAIAgentValidator = [
  body("name").optional().isString().withMessage("Name must be a string"),

  body("status")
    .optional()
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];

// ✅ Validator for updating an existing campaign
export const updateAIAgentValidator = [
  body("name").optional().isString().withMessage("Name must be a string"),

  body("status")
    .optional()
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];
