import { body } from "express-validator";

// ✅ Validator for creating a new contact follow-up
export const createConFollowupValidator = [
  body("Campaign")
    .optional()
    .isString()
    .withMessage("Campaign must be a string"),

  body("Range").optional().isString().withMessage("Range must be a string"),

  body("ContactNo")
    .optional()
    .isString()
    .withMessage("ContactNo must be a string"),

  body("Location")
    .optional()
    .isString()
    .withMessage("Location must be a string"),

  body("ContactType")
    .optional()
    .isString()
    .withMessage("ContactType must be a string"),

  body("Name")
    .notEmpty()
    .withMessage("Name is required")
    .isString()
    .withMessage("Name must be a string"),

  body("City").optional().isString().withMessage("City must be a string"),

  body("Address").optional().isString().withMessage("Address must be a string"),

  body("ContactIndustry")
    .optional()
    .isString()
    .withMessage("ContactIndustry must be a string"),

  body("ContactFunctionalArea")
    .optional()
    .isString()
    .withMessage("ContactFunctionalArea must be a string"),

  body("ReferenceId")
    .optional()
    .isString()
    .withMessage("ReferenceId must be a string"),

  body("Notes").optional().isString().withMessage("Notes must be a string"),

  body("Facilities")
    .optional()
    .isString()
    .withMessage("Facilities must be a string"),

  body("User").optional().isString().withMessage("User must be a string"),

  body("date")
    .optional()
    .isISO8601()
    .withMessage("date must be in ISO8601 format (YYYY-MM-DD)"),

  body("Email")
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Email must be valid"),

  body("CompanyName")
    .optional()
    .isString()
    .withMessage("CompanyName must be a string"),

  body("website").optional().isString().withMessage("website must be a string"),

  body("Status").optional().isString().withMessage("Status must be a string"),
];

// ✅ Validator for updating an existing contact follow-up
export const updateConFollowupValidator = [
  body("Campaign")
    .optional()
    .isString()
    .withMessage("Campaign must be a string"),

  body("Range").optional().isString().withMessage("Range must be a string"),

  body("ContactNo")
    .optional()
    .isString()
    .withMessage("ContactNo must be a string"),

  body("Location")
    .optional()
    .isString()
    .withMessage("Location must be a string"),

  body("ContactType")
    .optional()
    .isString()
    .withMessage("ContactType must be a string"),

  body("Name").optional().isString().withMessage("Name must be a string"),

  body("City").optional().isString().withMessage("City must be a string"),

  body("Address").optional().isString().withMessage("Address must be a string"),

  body("ContactIndustry")
    .optional()
    .isString()
    .withMessage("ContactIndustry must be a string"),

  body("ContactFunctionalArea")
    .optional()
    .isString()
    .withMessage("ContactFunctionalArea must be a string"),

  body("ReferenceId")
    .optional()
    .isString()
    .withMessage("ReferenceId must be a string"),

  body("Notes").optional().isString().withMessage("Notes must be a string"),

  body("Facilities")
    .optional()
    .isString()
    .withMessage("Facilities must be a string"),

  body("User").optional().isString().withMessage("User must be a string"),

  body("date")
    .optional()
    .isISO8601()
    .withMessage("date must be in ISO8601 format (YYYY-MM-DD)"),

  body("Email").optional().isEmail().withMessage("Email must be valid"),

  body("CompanyName")
    .optional()
    .isString()
    .withMessage("CompanyName must be a string"),

  body("website").optional().isString().withMessage("website must be a string"),

  body("Status").optional().isString().withMessage("Status must be a string"),
];
