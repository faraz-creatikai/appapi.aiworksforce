import { body } from "express-validator";

// ✅ Validator for creating a new Income Marketing entry
export const createExpenseMarketingValidator = [
  body("Date")
    .notEmpty()
    .withMessage("Date is required")
    .isISO8601()
    .withMessage("date must be in ISO8601 format (YYYY-MM-DD)"),

  body("PartyName")
    .notEmpty()
    .withMessage("Party Name is required")
    .isString()
    .withMessage("Party Name must be a string"),

  body("User")
    .notEmpty()
    .withMessage("User is required")
    .isString()
    .withMessage("User must be a string"),

  body("Expense")
    .notEmpty()
    .withMessage("Expense is required")
    .isString()
    .withMessage("Expense must be a string"),

  body("Amount")
    .notEmpty()
    .withMessage("Amount is required")
    .isString()
    .withMessage("Amount must be a string"),

  body("DueAmount")
    .optional()
    .isString()
    .withMessage("DueAmount must be a string"),

  body("PaymentMethode")
    .notEmpty()
    .withMessage("Payment Method is required")
    .isString()
    .withMessage("Payment Method must be a string"),

  body("Status")
    .optional()
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];

// ✅ Validator for updating an existing Income Marketing entry
export const updateExpenseMarketingValidator = [
  body("Date")
    .notEmpty()
    .withMessage("Date is required")
    .isISO8601()
    .withMessage("date must be in ISO8601 format (YYYY-MM-DD)"),

  body("PartyName")
    .optional()
    .isString()
    .withMessage("Party Name must be a string"),

  body("User").optional().isString().withMessage("User must be a string"),

  body("Expense").optional().isString().withMessage("Expense must be a string"),

  body("Amount").optional().isString().withMessage("Amount must be a string"),

  body("DueAmount")
    .optional()
    .isString()
    .withMessage("DueAmount must be a string"),

  body("PaymentMethode")
    .optional()
    .isString()
    .withMessage("Payment Method must be a string"),

  body("Status")
    .optional()
    .isIn(["Active", "Inactive"])
    .withMessage("Status must be either 'Active' or 'Inactive'"),
];
