import { PrismaClient } from "@prisma/client";

import ApiError from "../utils/ApiError.js";
import { followupAgent } from "../ai/agent.js";
import { notifyCustomerFollowupTaken, notifyFollowupNext } from "../jobs/notification/notificationEvents.js";
import { getCustomerAccessFilter } from "./controller.customer.js";
import { replacePlaceholders } from "./controller.messages.js";
import { sendBaileysWhatsApp } from "../config/twilio.js";
import { sendEmail } from "../config/mailer.js";
import { logActivity } from "../utils/activityLogger.js";

const prisma = new PrismaClient();

// ---------------------------------------------------
//  HELPER FUNCTION (TRANSFORM FOLLOWUP TO DESIRED FORMAT)
// ---------------------------------------------------
const transformFollowup = (followup) => ({
  _id: followup.id,
  customer: {
    _id: followup.customer?.id,
    Campaign: followup.customer?.Campaign || "",
    CustomerType: followup.customer?.CustomerType || "",
    CustomerSubType: followup.customer?.CustomerSubType || "",
    customerName: followup.customer?.customerName || "",
    ContactNumber: followup.customer?.ContactNumber || "",
    Email: followup.customer?.Email || "",
    City: followup.customer?.City || "",
    Location: followup.customer?.Location || "",
    Area: followup.customer?.Area || "",
    Adderess: followup.customer?.Adderess || "",
    Facillities: followup.customer?.Facillities || "",
    ReferenceId: followup.customer?.ReferenceId || "",
    CustomerId: followup.customer?.CustomerId || "",
    CustomerDate: followup.customer?.CustomerDate || "",
    CustomerYear: followup.customer?.CustomerYear || "",
    Other: followup.customer?.Other || "",
    Description: followup.customer?.Description || "",
    Video: followup.customer?.Video || "",
    Verified: followup.customer?.Verified || "",
    GoogleMap: followup.customer?.GoogleMap || "",
    CustomerImage: followup.customer?.CustomerImage || [],
    SitePlan: followup.customer?.SitePlan || [],
    isFavourite: followup.customer?.isFavourite || false,
    AssignTo: followup.customer?.AssignTo
      ? {
        _id: followup.customer.AssignTo.id,
        name: followup.customer.AssignTo.name,
        email: followup.customer.AssignTo.email,
        role: followup.customer.AssignTo.role,
        city: followup.customer.AssignTo.city,
        status: followup.customer.AssignTo.status,
      }
      : null,
    CreatedBy: followup.customer?.CreatedBy || null,
    isImported: followup.customer?.isImported || false,
    __v: followup.customer?.__v || 0,
    createdAt: followup.customer?.createdAt,
    updatedAt: followup.customer?.updatedAt,
  },
  StartDate: followup.StartDate || "",
  StatusType: followup.StatusType || "",
  FollowupNextDate: followup.FollowupNextDate || "",
  Description: followup.Description || "",
  CreatedBy: followup.CreatedBy || "",
  createdAt: followup.createdAt,
  updatedAt: followup.updatedAt,

  // Flattened customer fields
  Campaign: followup.customer?.Campaign || "",
  CustomerType: followup.customer?.CustomerType || "",
  CustomerSubType: followup.customer?.CustomerSubType || "",
  City: followup.customer?.City || "",
  Location: followup.customer?.Location || "",
  ReferenceId: followup.customer?.ReferenceId || "",
  customerName: followup.customer?.customerName || "",
  ContactNumber: followup.customer?.ContactNumber || "",
  AssignTo: followup.customer?.AssignTo
    ? {
      _id: followup.customer.AssignTo.id,
      name: followup.customer.AssignTo.name,
      email: followup.customer.AssignTo.email,
      role: followup.customer.AssignTo.role,
      city: followup.customer.AssignTo.city,
      status: followup.customer.AssignTo.status,
    }
    : null,

});


// ai followup 
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Above this, per-customer drafting is too slow/expensive — one copy is reused.
const PERSONALIZE_LIMIT = Number(process.env.FOLLOWUP_PERSONALIZE_LIMIT || 30);
const AI_CONCURRENCY = Number(process.env.FOLLOWUP_AI_CONCURRENCY || 4);

const historyFor = (customerId) =>
  prisma.followup.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { StartDate: true, StatusType: true, Description: true, FollowupNextDate: true, createdAt: true },
  }).then((rows) => rows.reverse());

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

export const createFollowupByAI = async (req, res, next) => {
  try {
    const admin = req.admin;
    const {
      customerIds = [],
      userPrompt,
      language = "hinglish",
      sendWhatsapp = true,
      sendEmail: emailOn = true,
      confirm = false,
      drafts = null,      // reviewed drafts coming back from the UI
    } = req.body;

    if (!userPrompt) return next(new ApiError(400, "userPrompt is required"));
    if (!Array.isArray(customerIds) || customerIds.length === 0)
      return next(new ApiError(400, "customerIds must be a non-empty array"));

    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIds } },
    });
    if (!customers.length) return next(new ApiError(404, "No contactable customers found"));

    const channels = { whatsapp: sendWhatsapp, email: emailOn };
    const adminId = admin?.id || admin?._id || null;
    const personalize = customers.length <= PERSONALIZE_LIMIT;

    /* ══════════ STEP 1: DRAFT — one message per customer, nothing saved ══════════ */
    if (!confirm) {
      let generated;

      if (personalize) {
        generated = await mapWithConcurrency(customers, AI_CONCURRENCY, async (c) => {
          try {
            const ai = await followupAgent(userPrompt, {
              customer: c,
              history: await historyFor(c.id),
              language,
              channels,
            });
            return {
              customerId: c.id,
              name: c.customerName,
              email: c.Email || null,
              phone: c.ContactNumber || null,
              data: ai.data,
              whatsapp: ai.whatsapp,
              emailContent: ai.email,
              aiMessage: ai.message,
              error: null,
            };
          } catch (err) {
            return {
              customerId: c.id, name: c.customerName,
              email: c.Email || null, phone: c.ContactNumber || null,
              data: null, whatsapp: null, emailContent: null, aiMessage: null,
              error: err.message,
            };
          }
        });
      } else {
        // Too many for per-customer drafting: one copy, {{Name}} tokens filled at send.
        const ai = await followupAgent(userPrompt, {
          customer: customers[0],
          history: await historyFor(customers[0].id),
          language,
          channels,
        });
        generated = customers.map((c) => ({
          customerId: c.id, name: c.customerName,
          email: c.Email || null, phone: c.ContactNumber || null,
          data: ai.data, whatsapp: ai.whatsapp, emailContent: ai.email,
          aiMessage: ai.message, error: null,
        }));
      }

      const ok = generated.filter((d) => !d.error);

      return res.status(200).json({
        success: true,
        preview: true,
        personalized: personalize,
        drafts: generated,
        // summary for the header — the classification is per-customer but usually agrees
        data: ok[0]?.data || null,
        aiMessage: ok[0]?.aiMessage || null,
        failed: generated.length - ok.length,
        willSendTo: {
          whatsapp: ok.filter((d) => d.whatsapp && d.phone).length,
          email: ok.filter((d) => d.emailContent && d.email).length,
        },
        note: personalize
          ? "Each customer got their own message. Review and edit any of them before sending."
          : `Over ${PERSONALIZE_LIMIT} customers — one copy is reused for everyone.`,
      });
    }

    /* ══════════ STEP 2: SEND — uses the reviewed drafts verbatim, no new AI calls ══════════ */
    if (!Array.isArray(drafts) || !drafts.length)
      return next(new ApiError(400, "drafts are required when confirm is true"));

    const byId = new Map(customers.map((c) => [c.id, c]));
    // Only accept drafts for customers actually in this request.
    const queue = drafts.filter((d) => byId.has(d.customerId));
    if (!queue.length) return next(new ApiError(400, "No drafts matched the selected customers"));

    const results = [];
    const waQueue = queue.filter((d) => d.whatsapp && byId.get(d.customerId)?.ContactNumber);
    let waDone = 0;

    for (const d of queue) {
      const c = byId.get(d.customerId);
      const sent = [];
      const errors = [];

      const followData = d.data || {};

      try {
        await prisma.followup.create({
          data: {
            customerId: c.id,
            StartDate: followData.StartDate || null,
            StatusType: followData.StatusType || null,
            FollowupNextDate: followData.FollowupNextDate || null,
            Description: followData.Description || null,
            CreatedById: adminId,
          },
        });
      } catch (err) {
        errors.push(`followup: ${err.message}`);
      }


      if (d.whatsapp && c.ContactNumber) {
        try {
          const clean = c.ContactNumber.replace(/[^\d]/g, "");
          const phone = clean.length === 10 ? `${process.env.DEFAULT_COUNTRY_CODE || "91"}${clean}` : clean;
          await sendBaileysWhatsApp(phone, replacePlaceholders(d.whatsapp, c));
          sent.push("whatsapp");
        } catch (err) {
          errors.push(`whatsapp: ${err.message}`);
        }
        waDone++;
        // ⚠️ BAN PROTECTION — human-like gap between numbers.
        if (waDone < waQueue.length) await delay(3000 + Math.floor(Math.random() * 4000));
      }

      if (d.emailContent?.subject && d.emailContent?.body && c.Email) {
        try {
          await sendEmail(
            c.Email,
            replacePlaceholders(d.emailContent.subject, c),
            replacePlaceholders(d.emailContent.body, c)
          );
          sent.push("email");
        } catch (err) {
          errors.push(`email: ${err.message}`);
        }
      }

      results.push({
        id: c.id,
        name: c.customerName,
        statusType: followData.StatusType,
        sent,
        ...(errors.length ? { errors } : {}),
      });
    }

    res.status(201).json({
      success: true,
      message: "Follow-ups created",
      count: results.length,
      whatsappSent: results.filter((r) => r.sent.includes("whatsapp")).length,
      emailSent: results.filter((r) => r.sent.includes("email")).length,
      skipped: customerIds.length - customers.length,
      results,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};



// ---------------------------------------------------
//  CREATE FOLLOWUP
// ---------------------------------------------------
export const createFollowup = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { customerId } = req.params;
    const { StartDate, StatusType, FollowupNextDate, Description } = req.body;

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) return next(new ApiError(404, "Customer not found"));

    const followup = await prisma.followup.create({
      data: {
        customerId,
        StartDate,
        StatusType,
        FollowupNextDate,
        Description,
        CreatedById: admin.id || admin._id,
      },
      include: { customer: true },
    });

    logActivity({
      req, admin,
      action: "create",
      entity: "followup",
      entityId: followup.id,
      entityName: followup.customer?.customerName,
      customerId: followup.customerId,
      followupId: followup.id,
      meta: { StatusType: followup.StatusType, FollowupNextDate: followup.FollowupNextDate },
    });



    // if next date is today, notify immediately
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const yyyy = today.getFullYear();
    const todayStr = `${dd}-${mm}-${yyyy}`;

    if (followup.FollowupNextDate === todayStr) {
      await notifyFollowupNext({ followup: followup, customer: followup.customer });
    }

    res.status(201).json({
      success: true,
      message: "Follow-up created successfully",
      data: transformFollowup(followup),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  GET ALL FOLLOWUPS (FILTERS + PAGINATION)
// ---------------------------------------------------

export const getFollowups = async (req, res, next) => {
  try {
    const admin = req.admin;

    const {
      page = 1, limit, keyword = "", StatusType, Campaign, CustomerSubType, PropertyType, City, Location, User,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const isPaginated = limit !== undefined;
    const perPage = isPaginated ? Math.max(1, parseInt(limit, 10)) : null;
    const skip = isPaginated ? (pageNum - 1) * perPage : undefined;

    // -------------------------
    // 1. FOLLOWUP FILTER (Ensures they only see followups they took)
    // -------------------------
    const whereFollowup = {};
    if (StatusType) whereFollowup.StatusType = StatusType.trim();
    if (admin.role !== "administrator") {
      whereFollowup.CreatedById = admin.id || admin._id;
    }
    const followupFilter = Object.keys(whereFollowup).length > 0 ? whereFollowup : {};

    // -------------------------
    // 2. CUSTOMER FIELD FILTERS (Query Params)
    // -------------------------
    const fieldFilters = {};
    if (Campaign) fieldFilters.Campaign = { contains: Campaign.trim() };
    if (PropertyType) fieldFilters.CustomerType = { contains: PropertyType.trim() };
    if (CustomerSubType) fieldFilters.CustomerSubType = { contains: CustomerSubType.trim() };
    if (City) fieldFilters.City = { contains: City.trim() };
    if (Location) fieldFilters.Location = { contains: Location.trim() };
    if (User) {
      fieldFilters.AssignTo = { some: { name: { contains: User.trim() } } };
    }

    // -------------------------
    // 3. KEYWORD FILTER
    // -------------------------
    let keywordFilter = null;
    if (keyword) {
      const kw = keyword.trim();
      keywordFilter = {
        OR: [
          { customerName: { contains: kw } },
          { ContactNumber: { contains: kw } },
          { Email: { contains: kw } },
          { City: { contains: kw } },
          { Location: { contains: kw } },
        ],
      };
    }

    // -------------------------
    // 4. CUSTOMER ACCESS FILTER (Ensures customer was created/assigned to them)
    // -------------------------
    // Await the new async access filter
    const accessFilter = await getCustomerAccessFilter(admin);

    // -------------------------
    // 5. MERGE ALL FILTERS SAFELY
    // -------------------------
    // Use an AND array to prevent Prisma from overwriting overlapping keys (like OR / AND)
    const combinedConditions = [];

    if (Object.keys(accessFilter).length > 0) combinedConditions.push(accessFilter);
    if (Object.keys(fieldFilters).length > 0) combinedConditions.push(fieldFilters);
    if (keywordFilter) combinedConditions.push(keywordFilter);

    const where = {
      ...(combinedConditions.length > 0 ? { AND: combinedConditions } : {}),
      followups: { some: followupFilter } // Only fetches customers that have valid followups
    };

    // -------------------------
    // 6. FETCH DATA
    // -------------------------
    const [total, customers] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        include: {
          AssignTo: true,
          followups: {
            where: followupFilter,
            orderBy: { createdAt: "desc" },
            include: {
              CreatedBy: { select: { id: true, name: true, email: true, role: true } },
            },
          },
        },
        ...(isPaginated && { skip, take: perPage }),
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    // -------------------------
    // 7. MAP RESPONSE FOR TABLE
    // -------------------------
    const mappedCustomers = customers.map((customer) => {
      const uniqueUsers = [...new Set(
        customer.followups.map(f => f.CreatedBy?.name).filter(Boolean)
      )].join(", ");

      const latestFollowup = customer.followups[0] || {};

      return {
        _id: latestFollowup.id || customer.id,
        customer: {
          ...customer,
          _id: customer.id,
        },
        StartDate: latestFollowup.StartDate || "",
        StatusType: latestFollowup.StatusType || "",
        FollowupNextDate: latestFollowup.FollowupNextDate || "",
        Description: latestFollowup.Description || "",
        CreatedBy: latestFollowup.CreatedBy || null,
        createdAt: latestFollowup.createdAt || customer.updatedAt,
        updatedAt: latestFollowup.updatedAt || customer.updatedAt,

        Campaign: customer.Campaign || "",
        CustomerType: customer.CustomerType || "",
        CustomerSubType: customer.CustomerSubType || "",
        City: customer.City || "",
        Location: customer.Location || "",
        ReferenceId: customer.ReferenceId || "",
        customerName: customer.customerName || "",
        ContactNumber: customer.ContactNumber || "",
        User: uniqueUsers || "N/A",
      };
    });

    res.status(200).json({
      success: true,
      total,
      currentPage: isPaginated ? pageNum : 1,
      totalPages: isPaginated ? Math.ceil(total / perPage) : 1,
      data: mappedCustomers,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  GET FOLLOWUPS BY CUSTOMER
// ---------------------------------------------------
export const getFollowupByCustomer = async (req, res, next) => {
  try {
    const { customerId } = req.params;

    const admin = req.admin; // 1. Extract the admin/user

    // 2. Build the where clause dynamically
    const whereClause = { customerId };

    // 3. Add the restriction for non-admins
    if (admin.role !== "administrator") {
      whereClause.CreatedById = admin.id || admin._id;
    }

    const followups = await prisma.followup.findMany({
      where: whereClause,
      include: { customer: true, CreatedBy: { select: { name: true } }, }, // just to get customer.id
      orderBy: { createdAt: "desc" },
    });

    const transformed = followups.map((f) => ({
      _id: f.id,
      customer: f.customer.id, // flatten to just customer ID
      StartDate: f.StartDate,
      StatusType: f.StatusType,
      FollowupNextDate: f.FollowupNextDate,
      Description: f.Description,
      CreatedBy: f.CreatedBy?.name || "N/A",
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      __v: 0, // to match MongoDB format
    }));

    res.status(200).json({
      success: true,
      total: transformed.length,
      data: transformed,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  GET FOLLOWUP BY ID
// ---------------------------------------------------
export const getFollowupById = async (req, res, next) => {
  try {
    const followup = await prisma.followup.findUnique({
      where: { id: req.params.id },
      include: { customer: true }, // only include customer to get its id
    });

    if (!followup) return next(new ApiError(404, "Follow-up not found"));

    // Transform the followup to match the desired response format
    const transformed = {
      _id: followup.id,
      customer: followup.customer.id, // only return customer ID
      StartDate: followup.StartDate,
      StatusType: followup.StatusType,
      FollowupNextDate: followup.FollowupNextDate,
      Description: followup.Description,
      createdAt: followup.createdAt,
      updatedAt: followup.updatedAt,
      __v: 0, // if you want to keep __v like MongoDB
    };

    res.status(200).json({ success: true, data: transformed });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  UPDATE FOLLOWUP
// ---------------------------------------------------
export const updateFollowup = async (req, res, next) => {
  try {
    const { StartDate, StatusType, FollowupNextDate, Description } = req.body;

    const updatedFollowup = await prisma.followup.update({
      where: { id: req.params.id },
      data: {
        ...(StartDate && { StartDate }),
        ...(StatusType && { StatusType }),
        ...(FollowupNextDate && { FollowupNextDate }),
        ...(Description && { Description }),
      },
      include: { customer: { include: { AssignTo: true } } },
    });

    logActivity({
      req, admin: req.admin,
      action: "update",
      entity: "followup",
      entityId: updatedFollowup.id,
      entityName: updatedFollowup.customer?.customerName,
      customerId: updatedFollowup.customerId,
      followupId: updatedFollowup.id,
      meta: { StatusType: updatedFollowup.StatusType },
    });

    res.status(200).json({
      success: true,
      message: "Follow-up updated successfully",
      data: transformFollowup(updatedFollowup),
    });
  } catch (error) {
    if (error.code === "P2025")
      return next(new ApiError(404, "Follow-up not found"));
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  DELETE FOLLOWUP
// ---------------------------------------------------
export const deleteFollowup = async (req, res, next) => {
  try {

    const existing = await prisma.followup.findUnique({
      where: { id: req.params.id },
      include: { customer: { select: { id: true, customerName: true } } },
    });
    await prisma.followup.delete({ where: { id: req.params.id } });



    logActivity({
      req, admin: req.admin,
      action: "delete",
      entity: "followup",
      entityId: req.params.id,
      entityName: existing?.customer?.customerName,
      customerId: existing?.customerId,
      followupId: req.params.id,
    });
    res
      .status(200)
      .json({ success: true, message: "Follow-up deleted successfully" });
  } catch (error) {
    if (error.code === "P2025")
      return next(new ApiError(404, "Follow-up not found"));
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  DELETE FOLLOWUPS BY CUSTOMER
// ---------------------------------------------------
export const deleteFollowupsByCustomer = async (req, res, next) => {
  try {
    const { customerId } = req.params;
    const result = await prisma.followup.deleteMany({ where: { customerId } });
    res.status(200).json({
      success: true,
      message: "All followups for this customer have been deleted",
      deletedCount: result.count,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};
