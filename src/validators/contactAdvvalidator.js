import { body } from "express-validator";

// ✅ Validator for creating a new contact advertisement
export const createContactAdvValidator = [
  body("StatusAssign")
    .optional()
    .isString()
    .withMessage("StatusAssign must be a string"),

  body("Campaign")
    .optional()
    .isString()
    .withMessage("Campaign must be a string"),

  body("ContactType")
    .optional()
    .isString()
    .withMessage("ContactType must be a string"),

  body("city").optional().isString().withMessage("city must be a string"),

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

// ✅ Validator for updating an existing contact advertisement
export const updateContactAdvValidator = [
  body("StatusAssign")
    .optional()
    .isString()
    .withMessage("StatusAssign must be a string"),

  body("Campaign")
    .optional()
    .isString()
    .withMessage("Campaign must be a string"),

  body("ContactType")
    .optional()
    .isString()
    .withMessage("ContactType must be a string"),

  body("city").optional().isString().withMessage("city must be a string"),

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
