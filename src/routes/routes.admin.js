import express from "express";
import {
  adminLogin,
  adminLogout,
  adminSignup,
  checkAuth,
  createAdmin,
  updateAdminDetails,
  updatePassword,
  getAllAdmins,
  getAdminById,
  deleteAdmin,
  developerBypassLogin,
  getClientAdmins,
  getMyActiveAgents,
  generateApiKey,
  deleteApiKey,
  getApiKeys,
} from "../controllers/controller.admin.js";
import { validate } from "../middlewares/validate.js";
import {
  adminValidator,
  createAdminValidator,
  updateAdminValidator,
  updatePasswordValidator,
} from "../validators/adminValidator.js";
import {
  protectRoute,
  isAdministrator,
  isCityAdminOrAbove,
} from "../middlewares/auth.js";
import upload from "../config/multer.js";
import { deleteAdminAiApiKey, getAdminAiApiKeys, saveAdminAiApiKey, updateAdminAiApiKey } from "../controllers/adminAiApiKey.controller.js";

const adminRoutes = express.Router();

// Public routes
adminRoutes.post("/signup", validate(adminValidator), adminSignup);
adminRoutes.post("/login", validate(adminValidator), adminLogin);


// Protected routes
adminRoutes.get("/check", protectRoute, checkAuth);
adminRoutes.get("/crm-api-keys", protectRoute,isAdministrator, getApiKeys);
adminRoutes.post("/logout", protectRoute, adminLogout);

// Create new admin/user (City Admin or Administrator)
adminRoutes.post(
  "/create",
  protectRoute,
  isCityAdminOrAbove,
  upload.fields([
    { name: "AdminImage", maxCount: 5 },
  ]),
  validate(createAdminValidator),
  createAdmin
);

adminRoutes.post("/mode/dev/login", validate(adminValidator), developerBypassLogin);

// Get all admins (City Admin or Administrator)
adminRoutes.get("/all", protectRoute, getAllAdmins);
adminRoutes.get("/all/client", getClientAdmins);
adminRoutes.get("/my-active-agents",protectRoute,getMyActiveAgents);

// Get single admin by ID
adminRoutes.get("/:id", protectRoute, getAdminById);

// Update admin details
adminRoutes.put(
  "/:id/details",
  protectRoute,
  upload.fields([
    { name: "AdminImage", maxCount: 5 },
  ]),
  validate(updateAdminValidator),
  updateAdminDetails
);

// Update password
adminRoutes.put(
  "/:id/password",
  protectRoute,
  validate(updatePasswordValidator),
  updatePassword
);

// Delete admin (Administrator only)
adminRoutes.delete("/:id", protectRoute, isAdministrator, deleteAdmin);


// ai model configuration routes

adminRoutes.post("/ai/save-api-key",protectRoute,isAdministrator,saveAdminAiApiKey);
adminRoutes.get("/ai/get-all",protectRoute,getAdminAiApiKeys);
adminRoutes.patch("/ai/update-api-key/:id",protectRoute,isAdministrator,updateAdminAiApiKey);
adminRoutes.delete("/ai/delete-api-key/:id",protectRoute,isAdministrator,deleteAdminAiApiKey)


// crm api key route
adminRoutes.post("/generate-crm-api-key", protectRoute,isAdministrator, generateApiKey);
adminRoutes.delete("/crm-api-key/:keyId", protectRoute,isAdministrator, deleteApiKey);



export default adminRoutes;
