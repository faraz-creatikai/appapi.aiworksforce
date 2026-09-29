import { body } from "express-validator";

// ✅ Validator for creating a new ComProEnq
export const createCusEnqValidator = [
  body("UserName")
    .optional()
    .isString()
    .withMessage("UserName must be a string"),

  body("PropertyName")
    .optional()
    .isString()
    .withMessage("PropertyName must be a string"),

  body("Description")
    .optional()
    .isString()
    .withMessage("Description must be a string"),

  body("date")
    .optional()
    .isISO8601()
    .withMessage("date must be a valid date in ISO8601 format (YYYY-MM-DD)"),
];

// ✅ Validator for updating an existing ComProEnq
export const updateCusEnqValidator = [
  body("UserName")
    .optional()
    .isString()
    .withMessage("UserName must be a string"),

  body("PropertyName")
    .optional()
    .isString()
    .withMessage("PropertyName must be a string"),

  body("Description")
    .optional()
    .isString()
    .withMessage("Description must be a string"),

  body("date")
    .optional()
    .isISO8601()
    .withMessage("date must be a valid date in ISO8601 format (YYYY-MM-DD)"),
];
