import { body } from "express-validator";

// ✅ Validator for creating a new Property
export const createPropertyValidator = [
  body("Campaign")
    .notEmpty()
    .withMessage("Campaign is required")
    .isString()
    .withMessage("Campaign must be a string"),

  body("PropertyType")
    .optional()
    .isString()
    .withMessage("PropertyType must be a string"),

  body("propertyName")
    .optional()
    .isString()
    .withMessage("propertyName must be a string"),

  body("PropertySubType")
    .optional()
    .isString()
    .withMessage("PropertySubType must be a string"),

  body("ContactNumber")
    .notEmpty()
    .withMessage("ContactNumber is required")
    .matches(/^[0-9]{10}$/)
    .withMessage("ContactNumber must be a valid 10-digit number"),

  body("City").optional().isString().withMessage("City must be a string"),

  body("Location")
    .optional()
    .isString()
    .withMessage("Location must be a string"),

  body("Area").optional().isString().withMessage("Area must be a string"),

  body("Adderess")
    .optional()
    .isString()
    .withMessage("Adderess must be a string"),

  body("Email")
    .optional()
    .isEmail()
    .withMessage("Email must be a valid email address"),

  body("ReferenceId")
    .optional()
    .isString()
    .withMessage("ReferenceId must be a string"),

  body("PropertyId")
    .optional()
    .isString()
    .withMessage("PropertyId must be a string"),

  body("PropertyDate")
    .optional()
    .isString()
    .withMessage("PropertyDate must be a string"),

  body("PropertyYear")
    .optional()
    .isString()
    .withMessage("PropertyYear must be a string"),

  body("Other").optional().isString().withMessage("Other must be a string"),

  body("Description")
    .optional()
    .isString()
    .withMessage("Description must be a string"),

  body("Video").optional().isString().withMessage("Video must be a string"),

  body("Verified")
    .optional()
    .isString()
    .withMessage("Verified must be a string"),

  body("GoogleMap")
    .optional()
    .isString()
    .withMessage("GoogleMap must be a string"),
];

// ✅ Validator for updating an existing Property
export const updatePropertyValidator = [
  body("Campaign")
    .optional()
    .isString()
    .withMessage("Campaign must be a string"),

  body("PropertyType")
    .optional()
    .isString()
    .withMessage("PropertyType must be a string"),

  body("propertyName")
    .optional()
    .isString()
    .withMessage("propertyName must be a string"),

  body("PropertySubType")
    .optional()
    .isString()
    .withMessage("PropertySubType must be a string"),

  body("ContactNumber").optional(),

  body("City").optional().isString().withMessage("City must be a string"),

  body("Location")
    .optional()
    .isString()
    .withMessage("Location must be a string"),

  body("Area").optional().isString().withMessage("Area must be a string"),

  body("Adderess")
    .optional()
    .isString()
    .withMessage("Adderess must be a string"),

  body("Email")
    .optional()
    .isEmail()
    .withMessage("Email must be a valid email address"),

  body("ReferenceId")
    .optional()
    .isString()
    .withMessage("ReferenceId must be a string"),

  body("PropertyId")
    .optional()
    .isString()
    .withMessage("PropertyId must be a string"),

  body("PropertyDate")
    .optional()
    .isString()
    .withMessage("PropertyDate must be a string"),

  body("PropertyYear")
    .optional()
    .isString()
    .withMessage("PropertyYear must be a string"),

  body("Other").optional().isString().withMessage("Other must be a string"),

  body("Description")
    .optional()
    .isString()
    .withMessage("Description must be a string"),

  body("Video").optional().isString().withMessage("Video must be a string"),

  body("Verified")
    .optional()
    .isString()
    .withMessage("Verified must be a string"),

  body("GoogleMap")
    .optional()
    .isString()
    .withMessage("GoogleMap must be a string"),
];
