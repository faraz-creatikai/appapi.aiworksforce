import express from "express";
import {
  createTemplate,
  getTemplates,
  getTemplateById,
  updateTemplate,
  deleteTemplate,
} from "../controllers/controller.template.js";
import { isAdministrator, protectRoute } from "../middlewares/auth.js";
import upload, { templateUpload } from "../config/multer.js";

const templateRoute = express.Router();

templateRoute.use(protectRoute);

templateRoute.post(
  "/",
  templateUpload.fields([{ name: "whatsappImage", maxCount: 5 }]), // 👈 changed from upload
  createTemplate
);
templateRoute.get("/", isAdministrator, getTemplates);
templateRoute.get("/:id", isAdministrator, getTemplateById);
templateRoute.put(
  "/:id",
  templateUpload.fields([{ name: "whatsappImage", maxCount: 5 }]), // 👈 changed from upload
  isAdministrator,
  updateTemplate
);
templateRoute.delete("/:id", isAdministrator, deleteTemplate);

export default templateRoute;
