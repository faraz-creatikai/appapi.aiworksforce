import express from "express";
import { protectCustomerRoute, protectRoute } from "../middlewares/auth.js";
import { 
  createCustomerEnquiry, getAdminEnquiryById, getAllAdminEnquiries, 
  getCustomerEnquiries, getCustomerEnquiryById, replyToEnquiryAsAdmin, 
  replyToEnquiryAsCustomer, updateEnquiryStatus 
} from "../controllers/controller.enquiry.js";

const enquiryRoutes = express.Router();

// ==========================================
// CUSTOMER ENQUIRY ROUTES
// ==========================================
enquiryRoutes.post("/customer", protectCustomerRoute, createCustomerEnquiry);
enquiryRoutes.get("/customer", protectCustomerRoute, getCustomerEnquiries);
enquiryRoutes.get("/customer/:id", protectCustomerRoute, getCustomerEnquiryById);
enquiryRoutes.post("/customer/:id/reply", protectCustomerRoute, replyToEnquiryAsCustomer);

// ==========================================
// ADMIN ENQUIRY ROUTES
// ==========================================
enquiryRoutes.get("/admin", protectRoute, getAllAdminEnquiries);
enquiryRoutes.get("/admin/:id", protectRoute, getAdminEnquiryById);
enquiryRoutes.post("/admin/:id/reply", protectRoute, replyToEnquiryAsAdmin);
enquiryRoutes.put("/admin/:id/status", protectRoute, updateEnquiryStatus);

export default enquiryRoutes;