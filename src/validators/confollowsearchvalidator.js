import { body } from "express-validator";

// ✅ Validator for creating a new contact follow-up search
export const createConFollowSearchValidator = [
  body("Campaign")
    .optional()
    .isString()
    .withMessage("Campaign must be a string"),

  body("ContactType")
    .optional()
    .isString()
    .withMessage("ContactType must be a string"),

  body("PropertyType")
    .optional()
    .isString()
    .withMessage("PropertyType must be a string"),

  body("StatusType")
    .optional()
    .isString()
    .withMessage("StatusType must be a string"),

  body("City").optional().isString().withMessage("City must be a string"),

  body("Location")
    .optional()
    .isString()
    .withMessage("Location must be a string"),

  body("User").optional().isString().withMessage("User must be a string"),

  body("Keyword").optional().isString().withMessage("Keyword must be a string"),

  body("Limit")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Limit must be a positive integer"),
];

// ✅ Validator for updating an existing contact follow-up search
export const updateConFollowSearchValidator = [
  body("Campaign")
    .optional()
    .isString()
    .withMessage("Campaign must be a string"),

  body("ContactType")
    .optional()
    .isString()
    .withMessage("ContactType must be a string"),

  body("PropertyType")
    .optional()
    .isString()
    .withMessage("PropertyType must be a string"),

  body("StatusType")
    .optional()
    .isString()
    .withMessage("StatusType must be a string"),

  body("City").optional().isString().withMessage("City must be a string"),

  body("Location")
    .optional()
    .isString()
    .withMessage("Location must be a string"),

  body("User").optional().isString().withMessage("User must be a string"),

  body("Keyword").optional().isString().withMessage("Keyword must be a string"),

  body("Limit")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Limit must be a positive integer"),
];
