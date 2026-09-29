import express from "express";
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  getCustomerById,
  updateCustomer,
  deleteAllCustomers,
  getFavouriteCustomers,
  assignCustomer,
  bulkAssignCityCustomers,
  checkDuplicateContacts,
  getTodayCustomers,
  qualifyCustomer,
  startCall,
  getCallLogs,
  getCallReport,
  deleteCallLogById,
  getRecommendedCustomer,
  dataMining,
  getClosedDeals,
  closeDeal,
  reopenDeal,
  getAllCustomers,
  addPropertiesToShortlist,
  getCustomerShortlist,
  removePropertiesFromShortlist,
  updateShortlistStatus,
  getDashboardStatsCount,
  getLeadSourcesStats,
  getLeadTemperatureStats,
  getVisitorsChartStats,
  getFollowupChartStats,
  getCustomerLocationStats,
  getRadarChartStats,
  getCustomerCount,
  getCustomFieldValues,
  archiveCustomer,
  unarchiveCustomer,
  getArchivedCustomers,
  getEmployeeDistribution,
  getEmployeeHighlights,
  customerLogin,
  checkCustomerAuth,
  customerLogout,
  getCustomerPortalData,
  getProjectUpdates,
} from "../controllers/controller.customer.js";

import upload from "../config/multer.js";
import { validate } from "../middlewares/validate.js";
import {
  createCustomerValidator,
  updateCustomerValidator,
} from "../validators/customerValidator.js";
import { isCityAdminOrAbove, protectCustomerRoute, protectRoute } from "../middlewares/auth.js";
import { uploadExcel } from "../middlewares/uploadExcel.js";
import {
  importCustomers,
  readCustomerHeaders, // ✅ <-- Import new header reader
} from "../controllers/customerImportController.js";


const customerRoutes = express.Router();

// ✅ Protected Routes
customerRoutes.use(protectRoute);


//dashboard routes
customerRoutes.get("/dashboard/stats-count", getDashboardStatsCount);
customerRoutes.get("/dashboard/distribution", getEmployeeDistribution);
customerRoutes.get("/dashboard/lead-source-stats", getLeadSourcesStats);
customerRoutes.get("/dashboard/lead-temperature-stats", getLeadTemperatureStats);
customerRoutes.get("/dashboard/visiter-chart-stats", getVisitorsChartStats);
customerRoutes.get("/dashboard/followup-chart-stats", getFollowupChartStats);
customerRoutes.get("/dashboard/customer-location-stats", getCustomerLocationStats);
customerRoutes.get("/dashboard/radar-chart-stats", getRadarChartStats);
customerRoutes.get("/dashboard/employee/highlights", getEmployeeHighlights);


//customer routes


customerRoutes.post("/login", customerLogin);
customerRoutes.get("/check-auth", protectCustomerRoute, checkCustomerAuth);
customerRoutes.post("/logout", customerLogout);

// Portal Data
customerRoutes.get("/portal-dashboard", protectCustomerRoute, getCustomerPortalData);
customerRoutes.get("/portel-updates", protectCustomerRoute, getProjectUpdates);

// 🧭 Base CRUD Routes
customerRoutes.get("/today", getTodayCustomers);
customerRoutes.get("/getcalllogs", getCallLogs);
customerRoutes.get("/get-call-report", getCallReport);
customerRoutes.get("/data-mining", dataMining);
customerRoutes.get("/get-customer-fields-values", getCustomFieldValues);
customerRoutes.get("/", getCustomer);
customerRoutes.get("/count", getCustomerCount);
customerRoutes.get("/all", getAllCustomers);


//shortlist recommended customers
customerRoutes.post('/shortlist', protectRoute, addPropertiesToShortlist);
customerRoutes.get('/shortlist/:customerId', protectRoute, getCustomerShortlist);
customerRoutes.delete('/shortlist', protectRoute, removePropertiesFromShortlist);
customerRoutes.put('/shortlist', protectRoute, updateShortlistStatus);


customerRoutes.post("/check-duplicates", checkDuplicateContacts);
customerRoutes.post("/qualification-agent", qualifyCustomer);
customerRoutes.post("/recommended-customers", getRecommendedCustomer);

customerRoutes.post("/agent-call", startCall);


customerRoutes.post(
  "/",
  upload.fields([
    { name: "CustomerImage", maxCount: 5 },
    { name: "SitePlan", maxCount: 5 },
  ]),
  validate(createCustomerValidator),
  createCustomer
);


customerRoutes.put(
  "/:id",
  upload.fields([
    { name: "CustomerImage", maxCount: 5 },
    { name: "SitePlan", maxCount: 5 },
  ]),
  /*   isCityAdminOrAbove, */
  validate(updateCustomerValidator),
  updateCustomer
);

// Assign & Reassign APIs
customerRoutes.post("/assign", assignCustomer);
customerRoutes.post("/assign-all-city", bulkAssignCityCustomers);

customerRoutes.delete("/:id", deleteCustomer);
customerRoutes.delete("/", deleteAllCustomers);

customerRoutes.get("/favourites/all", getFavouriteCustomers);

// 🧩 1️⃣ New API → Read headers from uploaded Excel
customerRoutes.post(
  "/import/headers",
  protectRoute,
  isCityAdminOrAbove,
  uploadExcel.single("file"),
  readCustomerHeaders
);

// 🧩 2️⃣ Existing API → Import customers (with optional fieldMapping)
customerRoutes.post(
  "/import",
  protectRoute,
  isCityAdminOrAbove,
  uploadExcel.single("file"),
  importCustomers
);

customerRoutes.get("/no, checkPhoneExists");

//call log delete route 
customerRoutes.delete("/delete-calllog/:id", deleteCallLogById);

//deal closing routes
customerRoutes.get("/closed-deals", protectRoute, getClosedDeals);
customerRoutes.post("/close-deal/:id", protectRoute, closeDeal);
customerRoutes.post("/reopen-deal/:id", protectRoute, reopenDeal);

//archieve routes
customerRoutes.patch("/archive", protectRoute, archiveCustomer);
customerRoutes.patch("/unarchive", protectRoute, unarchiveCustomer);
customerRoutes.get("/archived", protectRoute, getArchivedCustomers);

customerRoutes.get("/:id", getCustomerById);






export default customerRoutes;




