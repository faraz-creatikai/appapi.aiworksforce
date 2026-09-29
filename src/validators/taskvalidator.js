import { body } from "express-validator";

// ✅ Validator for creating a new task
export const createTaskValidator = [
  body("date")
    .optional()
    .isISO8601()
    .withMessage("date must be a valid ISO8601 date (YYYY-MM-DD)"),

  body("Time").optional().isString().withMessage("Time must be a string"),

  body("Description")
    .optional()
    .isString()
    .withMessage("Description must be a string"),

  body("User").optional().isString().withMessage("User must be a string"),
];

// ✅ Validator for updating an existing task
export const updateTaskValidator = [
  body("date")
    .optional()
    .isISO8601()
    .withMessage("date must be a valid ISO8601 date (YYYY-MM-DD)"),

  body("Time").optional().isString().withMessage("Time must be a string"),

  body("Description")
    .optional()
    .isString()
    .withMessage("Description must be a string"),

  body("User").optional().isString().withMessage("User must be a string"),
];
