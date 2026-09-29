import { body } from "express-validator";

export const createAmenityValidator = [
  body("Name").optional().isString().withMessage("Name must be a string"),

  body("Status")
    .optional()
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];

export const updateAmenityValidator = [
  body("Name").optional().isString().withMessage("Name must be a string"),

  body("Status")
    .optional()
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];
