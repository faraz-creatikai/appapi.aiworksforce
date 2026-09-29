import { body } from "express-validator";

// Login/Signup validator
export const adminValidator = [
  body("email")
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email address")
    .normalizeEmail(),
  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),
];

// Create admin validator
export const createAdminValidator = [
  body("name")
    .notEmpty()
    .withMessage("Name is required")
    .trim()
    .isLength({ min: 2 })
    .withMessage("Name must be at least 2 characters long"),
  body("email")
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email address")
    .normalizeEmail(),
  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),
  body("role")
    .notEmpty()
    .withMessage("Role is required")
    .isIn(["administrator","client_admin", "city_admin", "user", "agent"])
    .withMessage("Invalid role. Must be administrator, city_admin, or user"),
  body("city")
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage("City name must be at least 2 characters long"),
  body("phone")
    .optional()
    .trim()
    .isMobilePhone()
    .withMessage("Please provide a valid phone number"),
  body("AddressLine1")
    .optional()
    .trim()
    .isLength({ min: 3 })
    .withMessage("Address Line 1 must be at least 3 characters long"),
  body("AddressLine2").optional().trim(),
];

// Update admin details validator
export const updateAdminValidator = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage("Name must be at least 2 characters long"),
  body("email")
    .optional()
    .isEmail()
    .withMessage("Please provide a valid email address")
    .normalizeEmail(),
  body("phone")
    .optional()
    .trim()
    .isMobilePhone()
    .withMessage("Please provide a valid phone number"),
  body("AddressLine1")
    .optional()
    .trim()
    .isLength({ min: 3 })
    .withMessage("Address Line 1 must be at least 3 characters long"),
  body("AddressLine2").optional().trim(),
  body("city")
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage("City name must be at least 2 characters long"),
  body("status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Status must be either 'active' or 'inactive'"),
];

// Update password validator
export const updatePasswordValidator = [
  body("currentPassword")
    .optional()
    .isLength({ min: 6 })
    .withMessage("Current password must be at least 6 characters long"),
  body("newPassword")
    .notEmpty()
    .withMessage("New password is required")
    .isLength({ min: 6 })
    .withMessage("New password must be at least 6 characters long"),
];
