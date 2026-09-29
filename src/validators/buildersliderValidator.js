import { body } from "express-validator";

export const createBuilderValidator = [
  body("Status")
    .trim()
    .notEmpty()
    .withMessage("Status is required")
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];

export const updateBuilderValidator = [
  body("Status")
    .optional()
    .trim()
    .isIn(["Active", "InActive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];
