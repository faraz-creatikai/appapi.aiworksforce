import express from "express";
import cors from "cors";

import adminRoutes from "./routes/routes.admin.js";
import campaignRoutes from "./routes/route.campaign.js";
import typeRoutes from "./routes/route.type.js";
import subtypeRoutes from "./routes/route.subtype.js";
import contactCampaignRoutes from "./routes/route.contactcampaign.js";
import contactTypeRoutes from "./routes/route.contacttype.js";
import cityRoutes from "./routes/route.city.js";
import locationRoutes from "./routes/route.location.js";
import facilitiesRoutes from "./routes/route.facilities.js";
import amenityRoutes from "./routes/route.amenities.js";
import functionalAreaRoutes from "./routes/route.functionalArea.js";
import industryRoutes from "./routes/route.industries.js";
import referenceRoutes from "./routes/route.references.js";
import expenseRoutes from "./routes/route.expenses.js";
import incomeRoutes from "./routes/route.income.js";
import statustypeRoutes from "./routes/route.statustype.js";
import constatustypeRoutes from "./routes/route.constatustype.js";
import paymentRoutes from "./routes/route.payments.js";
import templateRoute from "./routes/route.template.js";
import incomeMarketingRoutes from "./routes/route.incomemarketing.js";
import ExpenseMarketingRoutes from "./routes/route.expensemarketing.js";
import taskRoutes from "./routes/route.task.js";
import scheduleRoutes from "./routes/route.schedule.js";
import companyProjectRoutes from "./routes/route.companyproject.js";
import builderRoutes from "./routes/route.builderslider.js";
import customerRoutes from "./routes/route.customer.js";
import followupRoutes from "./routes/route.cusfollowup.js";
import contactRoutes from "./routes/route.contact.js";
import cookieParser from "cookie-parser";
import confollowaddRoutes from "./routes/route.confollowadd.js";
import messageRoutes from "./routes/route.messages.js";
import requestUserRoutes from "./routes/route.requestUser.js";
import sublocationRoutes from "./routes/route.sublocation.js";
import priceRoutes from "./routes/route.price.js";
import customerFieldsRoutes from "./routes/route.customerFields.js";
import customerFieldLabelRoutes from "./routes/route.customerFieldLabel.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import aiAgentRoutes from "./routes/route.aiagent.js";
import leadtypeRoutes from "./routes/route.leadtype.js";
import airteliqCallRoutes from "./routes/route.airteliq.js";
import socialContentRoutes from "./routes/route.socialContent.js";
import propertyRoutes from "./routes/route.property.js";
import socialAuthRoutes from "./routes/route.socialAuth.js";
import notificationRoutes from "./routes/route.notification.js";
import { ALLOWED_ORIGINS } from "./config/cors-origins.js";
import salesScriptRoutes from "./routes/route.salesscript.js";
import tabblyRoutes from "./routes/route.tabbly.js";
import videoProjectRoutes from "./routes/route.videoProject.js";
import path from "path";
import brandRoutes from "./routes/brandRoutes.js";
import mcpRoutes from "./routes/route.mcp.js";
import activityRoutes from "./routes/activityRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import departmentRoutes from "./routes/route.department.js";
import designationRoutes from "./routes/route.designation.js";
import roleEmpRoutes from "./routes/route.roleemp.js";
import enquiryRoutes from "./routes/route.enquiry.js";

const app = express();
app.use(cookieParser());

app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  })
);
app.use(express.json());
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Routes
app.use("/api/brand",brandRoutes);
app.use("/api/attendance",attendanceRoutes);
app.use("/api/enquiry",enquiryRoutes);
app.use("/api/user",requestUserRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/mas/customerFields", customerFieldsRoutes);
app.use("/api/mas/cam", campaignRoutes);
app.use("/api/mas/type", typeRoutes);
app.use("/api/mas/sub", subtypeRoutes);
app.use("/api/mas/department", departmentRoutes);
app.use("/api/mas/designation", designationRoutes);
app.use("/api/mas/roleemp", roleEmpRoutes);
app.use("/api/mas/contactcampaign", contactCampaignRoutes);
app.use("/api/mas/contacttype", contactTypeRoutes);
app.use("/api/mas/city", cityRoutes);
app.use("/api/mas/loc", locationRoutes);
app.use("/api/mas/subloc", sublocationRoutes);
app.use("/api/mas/fac", facilitiesRoutes);
app.use("/api/mas/amen", amenityRoutes);
app.use("/api/mas/func", functionalAreaRoutes);
app.use("/api/mas/ind", industryRoutes);
app.use("/api/mas/ref", referenceRoutes);
app.use("/api/mas/leadtype", leadtypeRoutes);
app.use("/api/mas/price", priceRoutes);
app.use("/api/mas/exp", expenseRoutes);
app.use("/api/mas/inc", incomeRoutes);
app.use("/api/mas/statustype", statustypeRoutes);
app.use("/api/mas/con/statustype", constatustypeRoutes);
app.use("/api/mas/payments", paymentRoutes);
app.use("/api/v1/templates", templateRoute);
app.use("/api/fin/inc", incomeMarketingRoutes);
app.use("/api/fin/exp", ExpenseMarketingRoutes);
app.use("/api/task", taskRoutes);
app.use("/api/sch", scheduleRoutes);
app.use("/api/com/pro", companyProjectRoutes);
app.use("/api/mas/buil", builderRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/cus/followup", followupRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/con/follow/add", confollowaddRoutes);
app.use("/api/v1/messages", messageRoutes);
app.use("/api/customerfieldlabels",customerFieldLabelRoutes)
app.use("/api/aiagent",aiAgentRoutes)
app.use("/api/airteliq", airteliqCallRoutes);
app.use("/api/social-content", socialContentRoutes);
app.use("/api/social-auth",socialAuthRoutes);
app.use("/api/property", propertyRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/salesscript",salesScriptRoutes);
app.use("/api/tabbly",tabblyRoutes);
app.use("/api/video-project", videoProjectRoutes);
app.use("/api/activity", activityRoutes);

app.use("/api/mcp",mcpRoutes);

app.use(errorHandler);


export default app;
