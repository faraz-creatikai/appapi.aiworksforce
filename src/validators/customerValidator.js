import { body } from "express-validator";

// ✅ Validator for creating a new Customer
export const createCustomerValidator = [
  body("Campaign")
    .notEmpty()
    .withMessage("Campaign is required")
    .isString()
    .withMessage("Campaign must be a string"),

  body("CustomerType")
    .optional()
    .isString()
    .withMessage("CustomerType must be a string"),

  body("customerName")
    .optional()
    .isString()
    .withMessage("customerName must be a string"),

  body("CustomerSubType")
    .optional()
    .isString()
    .withMessage("CustomerSubType must be a string"),

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

  body("Facillities")
    .optional()
    .isString()
    .withMessage("Facillities must be a string"),

  body("ReferenceId")
    .optional()
    .isString()
    .withMessage("ReferenceId must be a string"),

  body("CustomerId")
    .optional()
    .isString()
    .withMessage("CustomerId must be a string"),

  body("CustomerDate")
    .optional()
    .isString()
    .withMessage("CustomerDate must be a string"),

  body("CustomerYear")
    .optional()
    .isString()
    .withMessage("CustomerYear must be a string"),

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

// ✅ Validator for updating an existing Customer
export const updateCustomerValidator = [
  body("Campaign")
    .optional()
    .isString()
    .withMessage("Campaign must be a string"),

  body("CustomerType")
    .optional()
    .isString()
    .withMessage("CustomerType must be a string"),

  body("customerName")
    .optional()
    .isString()
    .withMessage("customerName must be a string"),

  body("CustomerSubType")
    .optional()
    .isString()
    .withMessage("CustomerSubType must be a string"),

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

  body("Facillities")
    .optional()
    .isString()
    .withMessage("Facillities must be a string"),

  body("ReferenceId")
    .optional()
    .isString()
    .withMessage("ReferenceId must be a string"),

  body("CustomerId")
    .optional()
    .isString()
    .withMessage("CustomerId must be a string"),

  body("CustomerDate")
    .optional()
    .isString()
    .withMessage("CustomerDate must be a string"),

  body("CustomerYear")
    .optional()
    .isString()
    .withMessage("CustomerYear must be a string"),

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
