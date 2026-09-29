import { body } from "express-validator";

// Password strength regex: at least 1 uppercase, 1 number, 1 special char
const strongPasswordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{6,}$/;

// ✅ Signup Validator (for registration)
export const signupValidator = [
  body("email")
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email address"),

  body("fullName")
    .notEmpty()
    .withMessage("Full name is required")
    .isLength({ min: 3 })
    .withMessage("Full name must be at least 3 characters long"),

  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .matches(strongPasswordRegex)
    .withMessage(
      "Password must be at least 6 characters long and include one uppercase letter, one number, and one special character"
    ),
];

// ✅ Login Validator (only email and password)
export const loginValidator = [
  body("email")
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email address"),

  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),
];

// ✅ Update Validator (only fullName and password)
export const updateUserValidator = [
  body("fullName")
    .optional()
    .notEmpty()
    .withMessage("Full name cannot be empty")
    .isLength({ min: 3 })
    .withMessage("Full name must be at least 3 characters long"),

  body("password")
    .optional()
    .matches(strongPasswordRegex)
    .withMessage(
      "Password must be at least 6 characters long and include one uppercase letter, one number, and one special character"
    ),
];


export const userSignupValidator = [
  body("email")
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email address"),

  body("name")
    .notEmpty()
    .withMessage("name is required")
    .isLength({ min: 3 })
    .withMessage("name must be at least 3 characters long"),

  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .matches(strongPasswordRegex)
    .withMessage(
      "Password must be at least 6 characters long and include one uppercase letter, one number, and one special character"
    ),
];