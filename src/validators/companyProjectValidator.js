import { body } from "express-validator";

// ✅ Validator for creating a new Project
export const createProjectValidator = [
  body("ProjectName")
    .notEmpty()
    .withMessage("ProjectName is required")
    .isString()
    .withMessage("ProjectName must be a string"),

  body("ProjectType")
    .optional()
    .isString()
    .withMessage("ProjectType must be a string"),

  body("ProjectStatus")
    .optional()
    .isString()
    .withMessage("ProjectStatus must be a string"),

  body("City").optional().isString().withMessage("City must be a string"),

  body("Location")
    .optional()
    .isString()
    .withMessage("Location must be a string"),

  body("Area").optional().isString().withMessage("Area must be a string"),

  body("Range").optional().isString().withMessage("Range must be a string"),

  body("Adderess")
    .optional()
    .isString()
    .withMessage("Adderess must be a string"),

  body("Facillities")
    .optional()
    .isString()
    .withMessage("Facillities must be a string"),

  body("Amenities")
    .optional()
    .isString()
    .withMessage("Amenities must be a string"),

  body("Description")
    .optional()
    .isString()
    .withMessage("Description must be a string"),

  body("Video").optional().isString().withMessage("Video must be a string"),

  body("GoogleMap")
    .optional()
    .isString()
    .withMessage("GoogleMap must be a string"),
];

// ✅ Validator for updating an existing Project
export const updateProjectValidator = [
  body("ProjectName")
    .optional()
    .isString()
    .withMessage("ProjectName must be a string"),

  body("ProjectType")
    .optional()
    .isString()
    .withMessage("ProjectType must be a string"),

  body("ProjectStatus")
    .optional()
    .isString()
    .withMessage("ProjectStatus must be a string"),

  body("City").optional().isString().withMessage("City must be a string"),

  body("Location")
    .optional()
    .isString()
    .withMessage("Location must be a string"),

  body("Area").optional().isString().withMessage("Area must be a string"),

  body("Range").optional().isString().withMessage("Range must be a string"),

  body("Adderess")
    .optional()
    .isString()
    .withMessage("Adderess must be a string"),

  body("Facillities")
    .optional()
    .isString()
    .withMessage("Facillities must be a string"),

  body("Amenities")
    .optional()
    .isString()
    .withMessage("Amenities must be a string"),

  body("Description")
    .optional()
    .isString()
    .withMessage("Description must be a string"),

  body("Video").optional().isString().withMessage("Video must be a string"),

  body("GoogleMap")
    .optional()
    .isString()
    .withMessage("GoogleMap must be a string"),
];
