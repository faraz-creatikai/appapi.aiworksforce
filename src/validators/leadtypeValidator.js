import { body } from "express-validator";

export const createLeadTypeValidator = [
  body("Name").optional().isString().withMessage("Name must be a string"),

  body("Status")
    .optional()
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];

export const updateLeadTypeValidator = [
  body("Name").optional().isString().withMessage("Name must be a string"),

  body("Status")
    .optional()
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];
