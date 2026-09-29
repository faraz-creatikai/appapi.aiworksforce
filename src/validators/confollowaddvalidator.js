import { body } from "express-validator";

// Validator for creating a new contact follow-up add entry
export const createConFollowAddValidator = [
  body("StartDate")
    .optional()
    .isString()
    .withMessage("StartDate must be a string"),

  body("StatusType")
    .optional()
    .isString()
    .withMessage("StatusType must be a string"),

  body("FollowupNextDate")
    .optional()
    .isString()
    .withMessage("FollowupNextDate must be a string"),

  body("Description")
    .optional()
    .isString()
    .withMessage("Description must be a string"),
];

// Validator for updating an existing contact follow-up add entry
export const updateConFollowAddValidator = [
  body("StartDate")
    .optional()
    .isString()
    .withMessage("StartDate must be a string"),

  body("StatusType")
    .optional()
    .isString()
    .withMessage("StatusType must be a string"),

  body("FollowupNextDate")
    .optional()
    .isString()
    .withMessage("FollowupNextDate must be a string"),

  body("Description")
    .optional()
    .isString()
    .withMessage("Description must be a string"),
];
