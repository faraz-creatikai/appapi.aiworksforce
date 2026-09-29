import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";
import fs from "fs";
import cloudinary from "../config/cloudinary.js";
import { getKeywordSearchData, getRecommendedKeywordSearchData } from "../ai/getKeywordSearchData.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { CallingAgent, DataMiningAgent, QualifyAgent } from "../ai/agent.js";
import { callingAgentPrompt } from "../ai/prompts/callingAgentPrompt.js";
import { assignedUpdate, notifyCustomerCreated, stepUpdate } from "../jobs/notification/notificationEvents.js";
import { diffFields, logActivity } from "../utils/activityLogger.js";

dayjs.extend(utc);
dayjs.extend(timezone);

// ======================================================
//                   HELPERS
// ======================================================

const parseJSON = (field) => {
  if (!field) return [];
  if (typeof field === "string") {
    try {
      return JSON.parse(field);
    } catch {
      return [];
    }
  }
  return field;
};

const safeParse = (val) => {
  if (val === undefined || val === null || val === "") return undefined;
  if (Array.isArray(val)) return val;

  try {
    return JSON.parse(val);
  } catch {
    return undefined;
  }
};

const getPublicIdFromUrl = (url) => {
  try {
    const parts = url.split("/");
    const file = parts.pop();
    return file.split(".")[0];
  } catch {
    return null;
  }
};

// ------------------------------------------------------
//      Attach AssignTo information (only basic)
// ------------------------------------------------------
const transformGetCustomer = async (c, admin = null) => {
  const adminId = admin?.id || admin?._id;

  const base = {
    ...c,
    _id: c.id,
    CustomerDate: c.CustomerDate,
    CustomerImage: parseJSON(c.CustomerImage),
    SitePlan: parseJSON(c.SitePlan),
  };

  // Hide contact number only for user/agent viewing assigned customers
  if (
    admin &&
    (admin.role === "agent" || admin.role === "user") &&
    base.CreatedById !== adminId
  ) {
    base.ContactNumber = "forbidden"; // or "XXXXXXXXXX"
  }

  return base;
};

// ------------------------------------------------------
//      Transform single customer (getCustomerById)
// ------------------------------------------------------
const transformCustomer = async (c, admin = null) => {
  const adminId = admin?.id || admin?._id;

  const base = {
    ...c,
    _id: c.id,
    CustomerImage: parseJSON(c.CustomerImage),
    SitePlan: parseJSON(c.SitePlan),
  };

  // Hide contact number for assigned customers (not self-created)
  if (
    admin &&
    (admin.role === "agent" || admin.role === "user") &&
    base.CreatedById !== adminId
  ) {
    base.ContactNumber = "forbidden"; // or "XXXXXXXXXX"
  }

  const [
    campaignDoc,
    typeDoc,
    subTypeDoc,
    cityDoc,
    locationDoc,
    subLocationDoc,
    assignToDoc,
    createdByDoc,
  ] = await Promise.all([
    prisma.campaign.findFirst({
      where: { Name: c.Campaign },
      select: { id: true, Name: true },
    }),
    prisma.type.findFirst({
      where: { Name: c.CustomerType },
      select: { id: true, Name: true },
    }),
    prisma.subType.findFirst({
      where: { Name: c.CustomerSubType },
      select: { id: true, Name: true },
    }),
    prisma.city.findFirst({
      where: { Name: c.City },
      select: { id: true, Name: true },
    }),
    prisma.location.findFirst({
      where: { Name: c.Location },
      select: { id: true, Name: true },
    }),
    prisma.subLocation.findFirst({
      where: { Name: c.SubLocation },
      select: { id: true, Name: true },
    }),
    c.AssignToId
      ? prisma.admin.findUnique({
        where: { id: c.AssignToId },
        select: { id: true, name: true, email: true, role: true, city: true },
      })
      : null,
    c.CreatedBy
      ? prisma.admin.findUnique({
        where: { id: c.CreatedBy },
        select: { id: true, name: true, email: true },
      })
      : null,
  ]);

  return {
    ...base,
    Campaign: campaignDoc
      ? { _id: campaignDoc.id, Name: campaignDoc.Name }
      : { _id: null, Name: c.Campaign || "" },

    CustomerType: typeDoc
      ? { _id: typeDoc.id, Name: typeDoc.Name }
      : { _id: null, Name: c.CustomerType || "" },

    CustomerSubType: subTypeDoc
      ? { _id: subTypeDoc.id, Name: subTypeDoc.Name }
      : { _id: null, Name: c.CustomerSubType || "" },

    City: cityDoc
      ? { _id: cityDoc.id, Name: cityDoc.Name }
      : { _id: null, Name: c.City || "" },

    Location: locationDoc
      ? { _id: locationDoc.id, Name: locationDoc.Name }
      : { _id: null, Name: c.Location || "" },

    SubLocation: subLocationDoc
      ? { _id: subLocationDoc.id, Name: subLocationDoc.Name }
      : { _id: null, Name: c.SubLocation || "" },

    AssignTo: assignToDoc
      ? {
        _id: assignToDoc.id,
        name: assignToDoc.name,
        email: assignToDoc.email,
        role: assignToDoc.role,
        city: assignToDoc.city,
      }
      : null,

    CreatedBy: createdByDoc
      ? {
        _id: createdByDoc.id,
        name: createdByDoc.name,
        email: createdByDoc.email,
      }
      : null,
  };
};

const toBoolean = (val) => {
  if (val === undefined || val === null) return undefined;

  if (typeof val === "boolean") return val;

  if (typeof val === "string") {
    const lower = val.toLowerCase().trim();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }

  return undefined; // if invalid or empty string
};


export const getCustomerAccessFilter = async (admin) => {
  if (!admin) return { id: "__none__" }; // fail closed

  const adminId = admin.id || admin._id;
  const AND = [];

  // Original Condition #1
  if (admin.role !== "administrator" && admin.clientId) {
    AND.push({
      OR: [
        { ClientId: admin.clientId },
        { CreatedById: adminId },
      ],
    });
  }

  // Original Condition #2
  if (admin.role === "user" || admin.role === "agent") {
    AND.push({
      OR: [
        { AssignTo: { some: { id: adminId } } },
        { CreatedById: adminId },
      ],
    });
  }
  // Original Condition #3
  else if (admin.role === "city_admin") {
    const assignedCampaignsData = await prisma.customer.findMany({
      where: {
        AssignTo: {
          some: { id: adminId },
        },
      },
      select: {
        Campaign: true,
      },
      distinct: ["Campaign"],
    });

    const assignedCampaigns = assignedCampaignsData
      .map((c) => c.Campaign)
      .filter(Boolean);

    AND.push({
      City: {
        equals: admin.city,
      },
    });

    AND.push({
      OR: [
        { CreatedById: adminId },
        { AssignTo: { some: { id: adminId } } },
        ...(assignedCampaigns.length > 0
          ? [{ Campaign: { in: assignedCampaigns } }]
          : []),
      ],
    });
  }

  if (AND.length === 0) {
    return {};
  }

  return { AND };
};

// --------------------------------------------
// REMOVE DUPLICATES BY CONTACTNUMBER, KEEP LAST UPDATED
// --------------------------------------------
function deduplicateByContact(customers) {
  const map = new Map();

  customers.forEach((c) => {
    if (!c.ContactNumber) return; // skip empty
    const existing = map.get(c.ContactNumber);

    if (!existing) {
      map.set(c.ContactNumber, c);
    } else {
      // compare updatedAt (fallback to createdAt)
      const existingDate = existing.updatedAt || existing.createdAt;
      const currentDate = c.updatedAt || c.createdAt;

      if (currentDate > existingDate) {
        map.set(c.ContactNumber, c);
      }
    }
  });

  return Array.from(map.values());
}

// ======================================================
//                   CONTROLLERS
// ======================================================


// 1. Create a simple global cache store right at the top of your file
const customerCache = new Map();
const CACHE_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds

export const getAllCustomers = async (req, res, next) => {
  try {
    const admin = req.admin;
    const adminId = admin.id || admin._id;

    // ---------------------------------------------------------
    // 2. CHECK LOCAL CACHE
    // ---------------------------------------------------------
    const cacheKey = `customers:${adminId}:${admin.role}`;
    const cachedItem = customerCache.get(cacheKey);

    // If cache exists and hasn't expired (under 5 minutes old), return it instantly!
    if (cachedItem && (Date.now() - cachedItem.timestamp < CACHE_TIMEOUT)) {
      return res.status(200).json(cachedItem.data);
    }

    // ---------------------------------------------------------
    // 3. ISOLATED ROLE-BASED LOGIC
    // ---------------------------------------------------------
    let AND = [];

    const accessFilter = await getCustomerAccessFilter(admin);
    if (Object.keys(accessFilter).length > 0) {
      AND.push(accessFilter);
    }


    const where = AND.length ? { AND } : {};

    // ---------------------------------------------------------
    // 4. FAST DATABASE FETCH & TRANSFORM
    // ---------------------------------------------------------
    const customers = await prisma.customer.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      include: { AssignTo: true },
    });

    const transformed = await Promise.all(customers.map(transformGetCustomer, admin));

    // ---------------------------------------------------------
    // 5. SAVE TO CACHE FOR NEXT TIME
    // ---------------------------------------------------------
    customerCache.set(cacheKey, {
      data: transformed,
      timestamp: Date.now()
    });

    return res.status(200).json(transformed);

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ------------------------------------------------------
//               GET TODAY CUSTOMERS
// ------------------------------------------------------

export const getTodayCustomers = async (req, res, next) => {
  try {
    const admin = req.admin;
    const adminId = admin.id || admin._id;

    // TODAY RANGE
    const start = dayjs().tz("Asia/Kolkata").startOf("day").utc().toDate();
    const end = dayjs().tz("Asia/Kolkata").endOf("day").utc().toDate();

    //  OPTIMIZATION 1: Put the date filter first. 
    // This forces the SQL query planner to immediately shrink the search pool 
    // to ONLY today's records BEFORE calculating complex Role-Based rules.
    let AND = [
      {
        createdAt: {
          gte: start,
          lte: end,
        },
      },
    ];

    // --------------------------------------------
    // ROLE-BASED FILTERS
    // --------------------------------------------
    const accessFilter = await getCustomerAccessFilter(admin);

    if (Object.keys(accessFilter).length > 0) {
      AND.push(accessFilter);
    }

    // --------------------------------------------
    // EXECUTE FETCH
    // --------------------------------------------
    const customers = await prisma.customer.findMany({
      where: { AND },
      orderBy: { createdAt: "desc" },
      //distinct: ["ContactNumber"], // 🚀 Enforcing your unique leads rule

    });

    // 🚀 OPTIMIZATION 3: Concurrent Transformation
    // Forces the loop to process all records simultaneously instead of waiting sequentially.
    const transformedCustomers = await Promise.all(
      customers.map((c) => transformGetCustomer(c, admin))
    );

    return res.status(200).json(transformedCustomers);
  } catch (error) {
    next(error); // Passes the error to your global ApiError handler
  }
};

// ------------------------------------------------------
//               GET CUSTOMERS
// ------------------------------------------------------

// Lightweight in-memory cache for dashboard stats
const dashboardCache = {
  data: null,
  expiry: 0,
};

// Lightweight in-memory cache for lead sources
const leadSourceCache = {
  data: null,
  expiry: 0,
};

// Lightweight in-memory cache for lead temperatures
const tempCache = {
  data: null,
  expiry: 0,
};

// Lightweight in-memory cache for Visitors Chart
const visitorsChartCache = {
  data: null,
  expiry: 0,
};

// Lightweight in-memory cache for Followup Chart
const followupChartCache = {
  data: null,
  expiry: 0,
};

// Lightweight in-memory cache for location stats
const locationStatsCache = {
  data: null,
  expiry: 0,
};

// Lightweight in-memory cache for Agent Assignments
const radarChartCache = {
  data: null,
  expiry: 0,
};

// Set cache duration (e.g., 5 minutes)
const CACHE_TTL_MS = 0.1 * 60 * 1000;




export const getDashboardStatsCount = async (req, res, next) => {
  try {
    const admin = req.admin;

    const accessFilter = await getCustomerAccessFilter(admin);
    const customerWhere = Object.keys(accessFilter).length
      ? { AND: [accessFilter] }
      : {};
    const now = Date.now();

    // 1. Serve from cache if valid
    if (dashboardCache.data !== null && dashboardCache.expiry > now) {
      return res.status(200).json({
        success: true,
        data: dashboardCache.data,
        source: "cache"
      });
    }

    // Get exact local date string for TODAY (YYYY-MM-DD)
    const d = new Date();
    const todayString = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];

    // 2. Fetch all required data concurrently
    const [
      uniqueCustomers,
      totalEmployees,
      totalContacts,
      uniqueFollowups,
      incomeRecords,
      todayAttendance,
      totalTasks
    ] = await Promise.all([
      // 1. Leads: Unique customers by ContactNumber
      prisma.customer.findMany({
        where: customerWhere,
        distinct: ["ContactNumber"],
        select: { id: true },
      }),

      prisma.employee.findMany({
        select: { id: true },
      }),


      // 2. Contacts: Native DB counting
      prisma.contact.count(),

      // 3. Converted Leads: Unique customers in the Followup table
      prisma.followup.findMany({
        distinct: ["customerId"],
        select: { id: true }
      }),

      // 4. Income: Fetching only the Income field to sum it up
      prisma.income.findMany({
        select: { Name: true } // Assuming the field is named 'Income'
      }),

      // 5. TODAY'S ATTENDANCE: Count all statuses for today
      // Using `customer: customerWhere` ensures the admin only sees data for employees they are allowed to see
      prisma.employeeAttendance.findMany({
        where: {
          dateString: todayString,
        },
        select: { status: true }
      }),

      // 6. TASKS: Total tasks assigned to employees under this admin's purview
      prisma.task.count()
    ]);

    // Safely calculate the total revenue on the server
    const totalRevenue = incomeRecords.reduce(
      (sum, item) => sum + (Number(item.Name) || 0),
      0
    );

    // Safely aggregate today's attendance statuses
    const attendanceStats = {
      present: 0,
      half_day: 0,
      workfromhome: 0,
      leave: 0,
      absent: 0
    };

    todayAttendance.forEach(record => {
      if (attendanceStats[record.status] !== undefined) {
        attendanceStats[record.status]++;
      }
    });

    // Assemble final stats payload
    const stats = {
      totalCustomers: uniqueCustomers.length,
      convertedLeads: uniqueFollowups.length,
      totalContacts: totalContacts,
      totalEmployees: totalEmployees,
      totalIncome: totalRevenue,

      // --- New Attendance Data ---
      todayPresent: attendanceStats.present,
      todayHalfDay: attendanceStats.half_day,
      todayWFH: attendanceStats.workfromhome,
      todayLeave: attendanceStats.leave,
      todayAbsent: attendanceStats.absent,

      // --- New Task Data ---
      totalTasks: totalTasks
    };

    // 3. Update the cache
    dashboardCache.data = stats;
    dashboardCache.expiry = now + CACHE_TTL_MS;

    // 4. Return fresh response
    return res.status(200).json({
      success: true,
      data: stats,
      source: "database"
    });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const getEmployeeDistribution = async (req, res, next) => {
  try {
    // Defaulting to 'Department' instead of Campaign
    const { groupBy = 'Department' } = req.query;

    const validFields = ['Department', 'Designation', 'Role']; // Updated
    if (!validFields.includes(groupBy)) throw new ApiError(400, "Invalid grouping parameter.");

    const distribution = await prisma.employee.groupBy({ // Updated Table
      by: [groupBy],
      _count: { id: true },
    });

    let totalEmployees = 0;
    const mergedData = {};

    distribution.forEach((item) => {
      const count = item._count.id;
      totalEmployees += count;

      let name = item[groupBy];
      if (!name || name.trim() === '') name = 'Others';
      else name = name.trim();

      mergedData[name] = (mergedData[name] || 0) + count;
    });

    const finalData = Object.keys(mergedData).map((name) => {
      const value = mergedData[name];
      return {
        name, value,
        percentage: totalEmployees > 0 ? Math.round((value / totalEmployees) * 100) : 0,
      };
    }).sort((a, b) => b.value - a.value);

    const othersIndex = finalData.findIndex(item => item.name === 'Others');
    if (othersIndex > -1) {
      const othersItem = finalData.splice(othersIndex, 1)[0];
      finalData.push(othersItem);
    }

    res.status(200).json({ success: true, total: totalEmployees, data: finalData });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

export const getEmployeeHighlights = async (req, res, next) => {
  try {
    const employees = await prisma.employee.findMany({ // Updated Table
      select: {
        id: true,
        employeeName: true,
        Designation: true,
        Department: true,
        createdAt: true,
        EmployeeDate: true,
        EmployeeImage: true,
      }
    });

    const today = new Date(); today.setHours(0, 0, 0, 0);

    const parseDateStrict = (dateInput) => {
      if (!dateInput) return null;
      if (dateInput instanceof Date) return isNaN(dateInput.getTime()) ? null : dateInput;
      const dateStr = String(dateInput).trim();
      if (dateStr === "") return null;
      if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
        const [dd, mm, yyyy] = dateStr.split('-');
        return new Date(yyyy, mm - 1, dd);
      }
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? null : d;
    };

    const getNextOccurrence = (dateInput) => {
      const d = parseDateStrict(dateInput);
      if (!d) return null;
      const nextDate = new Date(today.getFullYear(), d.getMonth(), d.getDate());
      if (nextDate.getTime() < today.getTime()) nextDate.setFullYear(today.getFullYear() + 1);
      const daysRemaining = Math.ceil((nextDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return {
        cleanDateString: `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`,
        originalYear: d.getFullYear(),
        isToday: daysRemaining === 0,
        isTomorrow: daysRemaining === 1,
        daysRemaining
      };
    };

    const recentJoiners = [...employees]
      .filter(emp => parseDateStrict(emp.createdAt))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(emp => ({
        id: emp.id,
        name: emp.employeeName || "Unknown",
        role: emp.Designation || "Employee",
        department: emp.Department || "Staff",
        date: emp.createdAt,
        image: emp.EmployeeImage
      }));

    const upcomingBirthdays = employees
      .map(emp => {
        const occ = getNextOccurrence(emp.EmployeeDate);
        if (!occ || occ.daysRemaining > 30) return null;
        return {
          id: emp.id,
          name: emp.employeeName || "Unknown",
          date: occ.cleanDateString,
          isToday: occ.isToday,
          isTomorrow: occ.isTomorrow,
          daysRemaining: occ.daysRemaining,
          image: emp.EmployeeImage
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

    const workAnniversaries = employees
      .map(emp => {
        const occ = getNextOccurrence(emp.createdAt);
        if (!occ) return null;
        const years = parseInt(occ.cleanDateString.split('-')[0]) - occ.originalYear;
        if (years <= 0 || occ.daysRemaining > 30) return null;
        return {
          id: emp.id,
          name: emp.employeeName || "Unknown",
          date: occ.cleanDateString,
          years: years,
          isToday: occ.isToday,
          isTomorrow: occ.isTomorrow,
          daysRemaining: occ.daysRemaining,
          image: emp.EmployeeImage
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

    res.status(200).json({ success: true, data: { recentJoiners, upcomingBirthdays, workAnniversaries } });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};


export const getLeadSourcesStats = async (req, res, next) => {
  try {
    const admin = req.admin;

    const accessFilter = await getCustomerAccessFilter(admin);
    const where = Object.keys(accessFilter).length
      ? { AND: [accessFilter] }
      : {};

    const now = Date.now();

    if (leadSourceCache.data !== null && leadSourceCache.expiry > now) {
      return res.status(200).json({
        success: true,
        data: leadSourceCache.data,
        source: "cache",
      });
    }

    // 🚀 FIX: Removed the "where" clause so we fetch ALL unique leads
    const uniqueCustomers = await prisma.customer.findMany({
      where,
      // distinct: ["ContactNumber"],
      select: { ReferenceId: true },
    });

    const counts = {};

    uniqueCustomers.forEach((item) => {
      // Only count it if it actually exists
      if (item.ReferenceId) {
        const ref = item.ReferenceId.toLowerCase().trim();
        counts[ref] = (counts[ref] || 0) + 1;
      }
    });

    // Package the counts AND the true total
    const responseData = {
      counts,
      total: uniqueCustomers.length // True 1:1 match with main dashboard
    };

    leadSourceCache.data = responseData;
    leadSourceCache.expiry = now + CACHE_TTL_MS;

    return res.status(200).json({
      success: true,
      data: responseData,
      source: "database",
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};



export const getLeadTemperatureStats = async (req, res, next) => {
  try {
    const admin = req.admin;

    const accessFilter = await getCustomerAccessFilter(admin);

    const where = {
      AND: [
        accessFilter,
        {
          LeadTemperature: {
            not: null,
            not: ""
          }
        }
      ]
    };
    const now = Date.now();

    // 1. Serve from cache if valid
    if (tempCache.data !== null && tempCache.expiry > now) {
      return res.status(200).json({
        success: true,
        data: tempCache.data,
        source: "cache",
      });
    }

    // 2. Fetch UNIQUE customers by ContactNumber, selecting ONLY the LeadTemperature
    const uniqueCustomers = await prisma.customer.findMany({
      where,
      //distinct: ["ContactNumber"], // 🚀 Filters duplicates natively
      select: {
        LeadTemperature: true
      },
    });

    // 3. Initialize clean buckets
    const counts = { hot: 0, warm: 0, cold: 0 };

    // 4. Tally up the unique results
    uniqueCustomers.forEach((item) => {
      // Clean string (e.g., " Hot ", "HOT" -> "hot")
      const tempString = item.LeadTemperature.toLowerCase().trim();

      // Only count if it's a valid key ('hot', 'warm', or 'cold')
      if (tempString in counts) {
        counts[tempString] += 1;
      }
    });

    // 5. Update the cache
    tempCache.data = counts;
    tempCache.expiry = now + CACHE_TTL_MS;

    // 6. Send response
    return res.status(200).json({
      success: true,
      data: counts,
      source: "database",
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};



export const getVisitorsChartStats = async (req, res, next) => {
  try {
    const admin = req.admin;

    const accessFilter = await getCustomerAccessFilter(admin);
    const where = Object.keys(accessFilter).length
      ? { AND: [accessFilter] }
      : {};

    const now = new Date();

    // 1. Serve from cache if valid
    if (visitorsChartCache.data !== null && visitorsChartCache.expiry > now.getTime()) {
      return res.status(200).json({
        success: true,
        data: visitorsChartCache.data,
        source: "cache",
      });
    }

    // 2. Fetch UNIQUE customers by ContactNumber, selecting ONLY createdAt
    const uniqueCustomers = await prisma.customer.findMany({
      where,
      distinct: ["ContactNumber"],
      select: { createdAt: true },
    });

    // 3. Time boundaries
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const firstDayCurrentMonth = new Date(currentYear, currentMonth, 1);
    const firstDayLastMonth = new Date(currentYear, currentMonth - 1, 1);
    const lastDayLastMonth = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);

    let oldVisitorCount = 0;
    let lastMonthCount = 0;
    const newCustomers = []; // Keep dates for new customers to calculate cumulative growth
    const groupedByMonth = {};

    // 4. Process all dates in one single O(n) loop
    uniqueCustomers.forEach((c) => {
      const d = new Date(c.createdAt);
      const m = d.getMonth();
      const y = d.getFullYear();

      // Group for average calculation
      const key = `${y}-${m}`;
      groupedByMonth[key] = (groupedByMonth[key] || 0) + 1;

      // Old Customers (Created before this month)
      if (d < firstDayCurrentMonth) {
        oldVisitorCount++;
      }

      // Last Month Customers
      if (d >= firstDayLastMonth && d <= lastDayLastMonth) {
        lastMonthCount++;
      }

      // New Customers (Created this month)
      if (m === currentMonth && y === currentYear) {
        newCustomers.push(d);
      }
    });

    // Calculate Average
    const numMonths = Object.keys(groupedByMonth).length;
    const totalAll = uniqueCustomers.length;
    const avgPerMonth = numMonths > 0 ? totalAll / numMonths : 0;

    // 5. Generate Chart Timeline (6 intervals up to today)
    const today = now.getDate();
    const step = Math.ceil(today / 6);
    const chartData = [];

    for (let day = 1; day <= today; day += step) {
      const fullDate = new Date(currentYear, currentMonth, day);
      const formattedDate = fullDate.toLocaleString("en-US", { month: "short", day: "numeric" });

      // Count new customers created on or before this tick
      const newVisitorCount = newCustomers.filter((d) => d.getDate() <= day).length;

      chartData.push({
        date: formattedDate,
        newVisitor: newVisitorCount,
        oldVisitor: oldVisitorCount,
        lastMonth: lastMonthCount,
        avg: Math.round(avgPerMonth),
      });
    }

    // Ensure today's actual date is always the final tick
    const lastFormattedDate = new Date(currentYear, currentMonth, today).toLocaleString("en-US", { month: "short", day: "numeric" });
    if (!chartData.find((r) => r.date === lastFormattedDate)) {
      chartData.push({
        date: lastFormattedDate,
        newVisitor: newCustomers.length,
        oldVisitor: oldVisitorCount,
        lastMonth: lastMonthCount,
        avg: Math.round(avgPerMonth),
      });
    }

    // 6. Save to cache
    visitorsChartCache.data = chartData;
    visitorsChartCache.expiry = now.getTime() + CACHE_TTL_MS;

    return res.status(200).json({
      success: true,
      data: chartData,
      source: "database",
    });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


export const getFollowupChartStats = async (req, res, next) => {
  try {
    const now = new Date();

    // 1. Serve from cache if valid
    if (followupChartCache.data !== null && followupChartCache.expiry > now.getTime()) {
      return res.status(200).json({
        success: true,
        data: followupChartCache.data,
        source: "cache",
      });
    }

    // 2. Fetch ONLY the necessary date strings
    const allFollowups = await prisma.followup.findMany({
      select: {
        StartDate: true,
        FollowupNextDate: true
      },
    });

    // 3. Setup the 4-month buckets
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const months = Array.from({ length: 4 }).map((_, index) => {
      const d = new Date(currentYear, currentMonth + index, 1);
      return {
        month: d.getMonth(),
        year: d.getFullYear(),
        label: d.toLocaleString("en-US", { month: "short" }),
        count: 0,
      };
    });

    // Helper to parse DD-MM-YYYY
    const parseDDMMYYYY = (dateStr) => {
      const [day, month, year] = dateStr.split("-");
      return new Date(Number(year), Number(month) - 1, Number(day));
    };

    // 4. Process all dates in memory (O(n) speed)
    allFollowups.forEach((item) => {
      if (!item.StartDate && !item.FollowupNextDate) return;

      const startDate = item.StartDate ? new Date(item.StartDate) : null;
      const followupDate = item.FollowupNextDate ? parseDDMMYYYY(item.FollowupNextDate) : null;

      // Prefer FollowupNextDate over StartDate
      const checkDate = followupDate || startDate;

      // Skip if date parsing failed
      if (!checkDate || isNaN(checkDate.getTime())) return;

      // Drop into the correct bucket if it matches
      for (const m of months) {
        if (checkDate.getMonth() === m.month && checkDate.getFullYear() === m.year) {
          m.count += 1;
          break; // Stop checking once we find a match
        }
      }
    });

    // 5. Format exactly how Recharts expects it
    const formattedChart = months.map((m) => ({
      name: m.label,
      followups: m.count,
    }));

    // 6. Update the cache
    followupChartCache.data = formattedChart;
    followupChartCache.expiry = now.getTime() + CACHE_TTL_MS;

    // 7. Send response
    return res.status(200).json({
      success: true,
      data: formattedChart,
      source: "database",
    });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


export const getCustomerLocationStats = async (req, res, next) => {
  try {
    const admin = req.admin;

    const accessFilter = await getCustomerAccessFilter(admin);

    const where = {
      AND: [
        accessFilter,
        {
          Location: {
            not: null,
            not: ""
          }
        }
      ]
    };
    const now = Date.now();

    // 1. Serve from cache if valid
    if (locationStatsCache.data !== null && locationStatsCache.expiry > now) {
      return res.status(200).json({
        success: true,
        data: locationStatsCache.data,
        source: "cache",
      });
    }

    // 2. Fetch UNIQUE customers by ContactNumber, selecting ONLY the Location
    const uniqueCustomers = await prisma.customer.findMany({
      where,
      distinct: ["ContactNumber"], // Filters duplicates natively
      select: {
        Location: true
      },
    });

    // 3. Tally up the unique results in memory
    const locationMap = {};
    uniqueCustomers.forEach((item) => {
      // Normalize casing if needed, or leave as-is to preserve DB casing
      const loc = item.Location.trim();
      locationMap[loc] = (locationMap[loc] || 0) + 1;
    });

    // 4. Convert to sorted array [{ location: "New York", customers: 12 }, ...]
    const locationArray = Object.entries(locationMap)
      .map(([location, count]) => ({
        location,
        customers: count,
      }))
      .sort((a, b) => b.customers - a.customers);

    // 5. Update the cache
    locationStatsCache.data = locationArray;
    locationStatsCache.expiry = now + CACHE_TTL_MS;

    // 6. Send response
    return res.status(200).json({
      success: true,
      data: locationArray,
      source: "database",
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};



export const getRadarChartStats = async (req, res, next) => {
  try {
    const admin = req.admin;

    const accessFilter = await getCustomerAccessFilter(admin);
    const where = Object.keys(accessFilter).length
      ? { AND: [accessFilter] }
      : {};
    const now = Date.now();

    // 1. Serve from cache if valid
    if (radarChartCache.data !== null && radarChartCache.expiry > now) {
      return res.status(200).json({
        success: true,
        data: radarChartCache.data,
        source: "cache",
      });
    }

    // 2. Fetch UNIQUE customers by ContactNumber, selecting ONLY the AssignTo relation
    const uniqueCustomers = await prisma.customer.findMany({
      where,
      distinct: ["ContactNumber"], // Keep your unique leads logic intact
      select: {
        AssignTo: {
          select: { id: true, name: true }, // Only pull what we need to count
        },
      },
    });

    const totalCustomers = uniqueCustomers.length;
    const userMap = {};

    // 3. Tally up the assignments in memory (O(n) speed)
    uniqueCustomers.forEach((customer) => {
      // Skip if the customer has no assigned agents
      if (!customer.AssignTo || customer.AssignTo.length === 0) return;

      customer.AssignTo.forEach((user) => {
        if (!userMap[user.id]) {
          userMap[user.id] = { id: user.id, name: user.name, customers: 0 };
        }
        userMap[user.id].customers += 1;
      });
    });

    // 4. Format into an array, calculate percentages, and sort by highest load
    const result = Object.values(userMap)
      .map((user) => ({
        ...user,
        percentage: totalCustomers > 0
          ? Math.round((user.customers / totalCustomers) * 100)
          : 0,
      }))
      .sort((a, b) => b.customers - a.customers);

    // 5. Update the cache
    radarChartCache.data = result;
    radarChartCache.expiry = now + CACHE_TTL_MS;

    // 6. Send response
    return res.status(200).json({
      success: true,
      data: result,
      source: "database",
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


export const getCustomerCount = async (req, res, next) => {
  try {
    const admin = req.admin;
    let AND = [];

    // --------------------------------------------
    // 1. ROLE-BASED FILTERS
    // --------------------------------------------
    const accessFilter = await getCustomerAccessFilter(admin);

    if (Object.keys(accessFilter).length > 0) {
      AND.push(accessFilter);
    }

    // --------------------------------------------
    // 2. BASIC FILTERS
    // --------------------------------------------
    AND.push({ DealClosed: false });

    // (Add any of your other dynamic Keyword, Date, or Price filters here)

    const where = AND.length ? { AND } : {};

    // --------------------------------------------
    // 3. EXECUTE OPTIMIZED COUNT
    // --------------------------------------------
    const uniqueCustomers = await prisma.customer.findMany({
      where,
      distinct: ["ContactNumber"],
      // 🚀 OPTIMIZATION 2: The Index-Only Scan Trick
      // By selecting the exact field used in 'distinct', the DB resolves this 
      // instantly from memory without reading the actual row data.
      select: { ContactNumber: true },
    });

    return res.status(200).json({
      success: true,
      totalCount: uniqueCustomers.length // Lightning fast length calculation
    });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

//new scaled get controller with better performance
export const getCustomer = async (req, res, next) => {
  try {
    const admin = req.admin;

    const {
      Campaign, CustomerType, CustomerSubType, LeadTemperature, StatusType,
      City, Location, SubLocation, LeadType, Keyword, SearchIn, ReferenceId,
      MinPrice, MaxPrice, Price, isFavourite, StartDate, EndDate, Limit,
      Skip = 0, sort, User, ContactNumber, CustomerFields,
    } = req.query;

    let AND = [];
    const REQUIRED = Limit !== undefined ? Number(Limit) : 100;
    const offset = Number(Skip);

    // --------------------------------------------
    // 1. ROLE-BASED FILTERS (Database Level)
    // --------------------------------------------
    const accessFilter = await getCustomerAccessFilter(admin);

    if (Object.keys(accessFilter).length > 0) {
      AND.push(accessFilter);
    }

    // --------------------------------------------
    // 2. BASIC FILTERS (Database Level)
    // --------------------------------------------
    AND.push({ DealClosed: false });

    const adminId = admin.id || admin._id;
    AND.push({ archivedBy: { none: { adminId } } });

    if (Campaign) AND.push({ Campaign: { contains: Campaign.trim() } });
    if (CustomerType) AND.push({ CustomerType: { contains: CustomerType.trim() } });
    if (CustomerSubType) AND.push({ CustomerSubType: { contains: CustomerSubType.trim() } });
    if (StatusType) AND.push({ Verified: { contains: StatusType.trim() } });
    if (LeadTemperature) AND.push({ LeadTemperature: { contains: LeadTemperature.trim() } });
    if (LeadType) AND.push({ LeadType: { contains: LeadType.trim() } });
    if (City) AND.push({ City: { contains: City.trim() } });
    if (Location) AND.push({ Location: { contains: Location.trim() } });
    if (SubLocation) AND.push({ SubLocation: { contains: SubLocation.trim() } });
    if (ContactNumber) AND.push({ ContactNumber: { contains: ContactNumber.trim() } });
    if (ReferenceId) AND.push({ ReferenceId: { contains: ReferenceId.trim() } });
    if (Price) AND.push({ Price: { contains: Price.trim() } });

    // --------------------------------------------
    // 2B. CUSTOM FIELD FILTERS (dynamic JSON)
    // --------------------------------------------
    if (CustomerFields) {
      try {
        // Express automatically decodes the URL into a string.
        // This will successfully turn '{"State":"Gujarat"}' into a real object.
        const customFieldFilters = JSON.parse(CustomerFields);

        // Add this line to see the proof in your server console!
        console.log("✅ Parsed CustomerFields from Frontend:", customFieldFilters);

        Object.entries(customFieldFilters).forEach(([key, value]) => {
          const trimmed = String(value ?? "").trim();
          if (!trimmed) return;

          AND.push({
            CustomerFields: {
              // 1. Use standard SQL JSON dot-notation for the path
              path: `$.${key}`,

              // 2. Use 'equals' instead of 'string_contains'
              // string_contains inside JSON columns often fails in MySQL because 
              // the DB stores JSON string values wrapped in internal quotes. 
              // Prisma's 'equals' handles this natively.
              equals: trimmed,
            },
          });
        });
      } catch (err) {
        console.error("❌ JSON Parse Error:", err);
      }
    }

    const cleanNumber = (val) => Number(String(val || "").replace(/[^0-9]/g, ""));

    if (MinPrice || MaxPrice) {
      const min = MinPrice ? cleanNumber(MinPrice) : null;
      const max = MaxPrice ? cleanNumber(MaxPrice) : null;
      AND.push({
        PriceNumber: {
          ...(min !== null && !isNaN(min) && { gte: min }),
          ...(max !== null && !isNaN(max) && { lte: max }),
        }
      });
    }

    if (typeof isFavourite !== "undefined") {
      AND.push({ isFavourite: isFavourite === "true" });
    }

    // --------------------------------------------
    // 3. FIX: ADVANCED FILTERS BROUGHT TO DB LEVEL
    // --------------------------------------------

    // Fix A: Move User filtering directly into Prisma query where clause
    if (User) {
      const userLower = User.toLowerCase();
      const matchingAdmins = await prisma.admin.findMany({
        where: {
          OR: [
            { name: { contains: User } },
            { email: { contains: User } },
            { city: { contains: User } },
            ["admin", "city_admin", "user"].includes(userLower) ? { role: { equals: User } } : undefined,
          ].filter(Boolean),
        },
        select: { id: true },
      });
      const allowedAdminIds = matchingAdmins.map((a) => a.id);
      AND.push({ AssignTo: { some: { id: { in: allowedAdminIds } } } });
    }

    // Fix B: Move Date Range parameters directly into the DB structure
    if (StartDate && EndDate) {
      // Assumes standard ISO/YYYY-MM-DD format handling at DB level. 
      // If CustomerDate is a string field, ensure your data formatting is uniform.
      AND.push({
        CustomerDate: {
          gte: StartDate,
          lte: EndDate
        }
      });
    }

    // --------------------------------------------
    // 4. KEYWORD SEARCH
    // --------------------------------------------
    const keyword = Keyword?.trim();
    if (keyword) {
      const { tokens, fields, priceRange } = await getKeywordSearchData(keyword);

      if (tokens.length > 0) {
        AND.push({
          AND: tokens.map((t) => ({
            OR: fields.map((field) => ({ [field]: { contains: t } })),
          })),
        });
      }

      if (priceRange?.min || priceRange?.max) {
        const min = priceRange?.min !== null ? cleanNumber(priceRange.min) : null;
        const max = priceRange?.max !== null ? cleanNumber(priceRange.max) : null;

        if (!isNaN(min) || !isNaN(max)) {
          AND.push({
            PriceNumber: {
              ...(min !== null && !isNaN(min) && { gte: min }),
              ...(max !== null && !isNaN(max) && { lte: max }),
            }
          });
        }
      }
    }


    const where = AND.length ? { AND } : {};
    const isAsc = sort?.toLowerCase() === "asc";
    const isAdminRole = ["administrator", "client_admin"].includes(admin.role);

    const orderBy = isAsc
      ? [{ createdAt: "asc" }]
      : [{ updatedAt: "desc" }, { createdAt: "desc" }];

    // --------------------------------------------
    // 🚀 SCAN + LOGS (Concurrent Execution)
    // --------------------------------------------
    const [base, logs] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy,
        select: { id: true, createdAt: true, updatedAt: true, ContactNumber: true },
      }),
      prisma.customerAssignLog.findMany({
        where: isAdminRole
          ? { OR: [{ assignedById: adminId }, { adminId }] }
          : { adminId },
        select: { customerId: true, assignedAt: true },
      }),
    ]);

    // --------------------------------------------
    // DEDUPE FIRST (same as old distinct → full pages)
    // --------------------------------------------
    let ordered = base;

    if (!ContactNumber) {
      const seen = new Set();
      ordered = [];
      for (const c of base) {
        if (seen.has(c.ContactNumber)) continue;
        seen.add(c.ContactNumber);
        ordered.push(c);
      }
    }

    const totalRecords = ordered.length;

    // --------------------------------------------
    // PER-VIEWER ASSIGNMENT RECENCY
    // --------------------------------------------
    const assignedMap = new Map();
    for (const l of logs) {
      const prev = assignedMap.get(l.customerId);
      if (!prev || l.assignedAt > prev) assignedMap.set(l.customerId, l.assignedAt);
    }

    // ONLY the ordering changes; asc path left exactly as the DB returned it
    if (!isAsc) {
      const keyOf = (c) => {
        const a = assignedMap.get(c.id);
        return Math.max(
          a ? a.getTime() : 0,
          c.updatedAt ? c.updatedAt.getTime() : 0,
          c.createdAt.getTime()
        );
      };
      ordered.sort((x, y) => keyOf(y) - keyOf(x));
    }

    // --------------------------------------------
    // PAGE (full pages, same skip/take semantics)
    // --------------------------------------------
    const start = Number.isFinite(offset) ? offset : 0;
    const end = Limit !== undefined && Number.isFinite(REQUIRED)
      ? start + REQUIRED
      : undefined;

    const pageIds = ordered.slice(start, end).map((c) => c.id);

    const rows = pageIds.length
      ? await prisma.customer.findMany({
        where: { id: { in: pageIds } },
        include: {
          AssignTo: {
            select: { id: true, name: true, email: true, role: true, city: true }
          },
          _count: { select: { shortlistedProperties: true } }
        },
      })
      : [];

    // findMany({ id: { in } }) returns DB order — restore our order
    const byId = new Map(rows.map((r) => [r.id, r]));
    const customers = pageIds.map((id) => byId.get(id)).filter(Boolean);

    // --------------------------------------------
    // FINAL TRANSFORM & RESPONSE
    // --------------------------------------------
    const transformed = await Promise.all(customers.map(transformGetCustomer, admin));
    if (admin.role === "agent") {
      transformed.forEach((customer) => {
        if (customer.CreatedById !== (admin.id || admin._id)) {
          customer.ContactNumber = "Forbidden"; // or "**********"
        }
      });
    }

    // Optional but highly recommended: Send the totalRecords back in headers or a wrapper 
    // so the frontend doesn't have to guess the pagination.
    res.setHeader('X-Total-Count', totalRecords);

    return res.status(200).json(transformed);

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// GET /customer/custom-field-values
// Scans CustomerFields across records the admin can see, returns { key: [distinct values] }
export const getCustomFieldValues = async (req, res, next) => {
  try {
    const admin = req.admin;
    let AND = [];

    // same role scoping as getCustomer — otherwise a client/city-scoped admin
    // could see custom field values from data they shouldn't have access to
    if (admin.role !== "administrator" && admin.clientId) {
      AND.push({
        OR: [{ ClientId: admin.clientId }, { CreatedById: admin.id || admin._id }],
      });
    }
    if (admin.role === "user") {
      const adminId = admin.id || admin._id;
      AND.push({
        OR: [{ AssignTo: { some: { id: adminId } } }, { CreatedById: adminId }],
      });
    } else if (admin.role === "city_admin") {
      AND.push({ City: { equals: admin.city } });
    }

    const where = AND.length ? { AND } : {};

    const rows = await prisma.customer.findMany({
      where,
      select: { CustomerFields: true },
    });

    const valueMap = {};
    rows.forEach((row) => {
      const cf = row.CustomerFields;
      if (!cf || typeof cf !== "object") return;
      Object.entries(cf).forEach(([key, value]) => {
        const trimmed = String(value ?? "").trim();
        if (!trimmed) return;
        if (!valueMap[key]) valueMap[key] = new Set();
        valueMap[key].add(trimmed);
      });
    });

    const result = Object.fromEntries(
      Object.entries(valueMap).map(([key, set]) => [
        key,
        Array.from(set).sort((a, b) => a.localeCompare(b)).slice(0, 200), // cap payload size
      ])
    );

    return res.status(200).json(result);
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ------------------------------------------------------
//               GET SINGLE CUSTOMER
// ------------------------------------------------------
export const getCustomerById = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return next(new ApiError(404, "Customer not found"));

    // role: user → only if assigned to them
    if (admin.role === "user" && customer.AssignToId !== admin.id)
      return next(new ApiError(403, "Access denied"));

    // role: city_admin → only same city
    /*  if (admin.role === "city_admin" && customer.City !== admin.city)
       return next(new ApiError(403, "Access denied")); */

    const response = await transformCustomer(customer, admin);
    res.status(200).json(response);
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// --------------------------------------------
// CHECK DUPLICATE CONTACT NUMBERS (BATCH)
// --------------------------------------------
export const checkDuplicateContacts = async (req, res) => {
  try {
    const { contactNumbers } = req.body;

    // सुरक्षा: ensure array exists
    if (!contactNumbers || !Array.isArray(contactNumbers)) {
      return res.status(400).json({
        success: false,
        message: "contactNumbers must be an array"
      });
    }

    // Remove empty/null & duplicates
    const uniqueNumbers = [...new Set(contactNumbers.filter(Boolean))];

    if (uniqueNumbers.length === 0) {
      return res.json({});
    }

    // Query DB
    const customers = await prisma.customer.findMany({
      where: {
        ContactNumber: {
          in: uniqueNumbers
        }
      },
      select: {
        ContactNumber: true,
        id: true
      }
    });

    // --------------------------------------------
    // Count occurrences
    // --------------------------------------------
    const countMap = {};

    for (const c of customers) {
      countMap[c.ContactNumber] = (countMap[c.ContactNumber] || 0) + 1;
    }

    // --------------------------------------------
    // Build response
    // --------------------------------------------
    const result = {};

    for (const num of uniqueNumbers) {
      result[num] = (countMap[num] || 0) > 1;
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error("checkDuplicateContacts Error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong"
    });
  }
};


// CREATE CUSTOMER
export const createCustomer = async (req, res, next) => {
  try {
    const admin = req.admin;
    const body = req.body;

    // --- PASSWORD HASHING ---
    if (body.Password) {
      const salt = await bcrypt.genSalt(10);
      body.Password = await bcrypt.hash(body.Password, salt);
    }

    let CustomerImage = [];
    let SitePlan = [];

    if (req.files?.CustomerImage) {
      const uploads = req.files.CustomerImage.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "customer/customer_images",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );
      CustomerImage = await Promise.all(uploads);
    }

    if (req.files?.SitePlan) {
      const uploads = req.files.SitePlan.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "customer/site_plans",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );
      SitePlan = await Promise.all(uploads);
    }

    // --- Get active fields from master ---
    const activeFields = await prisma.customerFields.findMany({
      where: { Status: "Active" },
      select: { Name: true },
    });
    const allowedKeys = new Set(activeFields.map((f) => f.Name));

    const customerFieldsRaw = body.CustomerFields ? JSON.parse(body.CustomerFields) : {};
    // --- Build CustomerFields JSON ---
    const customerFieldsData = {};
    for (const key in customerFieldsRaw) {
      if (allowedKeys.has(key)) {
        customerFieldsData[key] = customerFieldsRaw[key];
      }
    }
    let PriceNumber = 0;
    /*     if (body.Price) {
          PriceNumber = Number(
            body.Price.toString().replace(/[^0-9.]/g, "")
          )
        } */


    if (body.Price) {
      const raw = body.Price.toString().toLowerCase();

      let multiplier = 1;
      if (raw.includes("thousand") || raw.includes("thousands") || raw.includes("हज़ार")) {
        multiplier = 1000;
      }
      else if (raw.includes("lakh") || raw.includes("लाख")) {
        multiplier = 100000;
      } else if (
        raw.includes("crore") ||
        raw.includes("करोड़") ||
        raw.includes("cr")
      ) {
        multiplier = 10000000;
      }

      PriceNumber =
        Number(raw.replace(/[^0-9.]/g, "")) * multiplier;
    }

    const newCustomer = await prisma.customer.create({
      data: {
        ...body,
        PriceNumber: PriceNumber,
        ClientId: admin.clientId,
        Email: body.Email || undefined,
        CustomerImage: JSON.stringify(CustomerImage),
        SitePlan: JSON.stringify(SitePlan),
        CustomerFields: customerFieldsData,
        AssignTo:
          admin.role === "user"
            ? {
              connect: [{ id: admin._id || admin.id }],
            }
            : undefined,
        CreatedById: admin._id || admin.id,
      },
    });

    logActivity({
      req, admin,
      action: "create",
      entity: "customer",
      entityId: newCustomer.id,
      entityName: newCustomer.customerName,
      customerId: newCustomer.id,
      meta: { campaign: newCustomer.Campaign, city: newCustomer.City },
    });

    /* web hook trigger n8n  */
    /*     const automationRes = await fetch("http://localhost:5678/webhook/customer-created", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            customerId: newCustomer.id,
            name: newCustomer.customerName,
            phone: newCustomer.ContactNumber
          })
        });
        console.log(" automation res is ", automationRes) */

    // 🔥 UNIVERSAL EVENT TRIGGER
    /*     await notifyCustomerCreated({
          customer: newCustomer,
          admin,
        }); */

    res
      .status(201)
      .json({ success: true, data: await transformCustomer(newCustomer, admin) });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};




export const updateCustomer = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { id } = req.params;

    let updateData = { ...req.body };

    // ✅ BOOLEAN PARSER ADDED
    const toBoolean = (val) => {
      if (val === undefined || val === null) return undefined;
      if (typeof val === "boolean") return val;
      if (typeof val === "string") {
        const lower = val.toLowerCase().trim();
        if (lower === "true") return true;
        if (lower === "false") return false;
      }
      return undefined;
    };

    // SAFE PARSE (unchanged)
    const safeParse = (value) => {
      if (value === undefined || value === null || value === "")
        return undefined;
      if (Array.isArray(value)) return value;
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    };

    // --- PASSWORD HASHING ---
    if (updateData.Password && updateData.Password.trim() !== "") {
      const salt = await bcrypt.genSalt(10);
      updateData.Password = await bcrypt.hash(updateData.Password, salt);
    } else {
      delete updateData.Password; // Don't overwrite existing password with empty string
    }

    // PARSE FIELDS FROM FRONTEND
    updateData.CustomerImage = safeParse(updateData.CustomerImage);
    updateData.SitePlan = safeParse(updateData.SitePlan);

    updateData.removedCustomerImages =
      safeParse(updateData.removedCustomerImages) || [];

    updateData.removedSitePlans = safeParse(updateData.removedSitePlans) || [];

    // FETCH CUSTOMER
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return next(new ApiError(404, "Customer not found"));

    if (admin.role !== "administrator" && admin.clientId) {
      if (existing.ClientId !== admin.clientId) {
        return next(
          new ApiError(403, "You cannot modify another company's customer")
        );
      }
    }

    // --- Get active fields from master ---
    const activeFields = await prisma.customerFields.findMany({
      where: { Status: "Active" },
      select: { Name: true },
    });
    const allowedKeys = new Set(activeFields.map((f) => f.Name));

    // --- Build CustomerFields JSON from request ---
    const customerFieldsRaw = req.body.CustomerFields
      ? typeof req.body.CustomerFields === "string"
        ? JSON.parse(req.body.CustomerFields)
        : req.body.CustomerFields
      : {};

    // --- Merge with existing CustomerFields ---
    const existingCustomerFields = existing.CustomerFields || {};
    const mergedCustomerFields = {
      ...existingCustomerFields,
      ...Object.fromEntries(
        Object.entries(customerFieldsRaw).filter(([key]) =>
          allowedKeys.has(key)
        )
      ),
    };
    updateData.CustomerFields = mergedCustomerFields;


    // ROLE PERMISSIONS
    if (
      admin.role === "user" &&
      existing.AssignToId !== (admin._id || admin.id)
    ) {
      return next(new ApiError(403, "You can only update your own customers"));
    }

    if (admin.role === "city_admin" && existing.City !== admin.city) {
      return next(
        new ApiError(403, "You can only update customers in your city")
      );
    }

    // LOAD EXISTING IMAGES — FIXED
    let CustomerImage = safeParse(existing.CustomerImage) || [];
    let SitePlan = safeParse(existing.SitePlan) || [];

    if (typeof existing.CustomerImage === "string") {
      try {
        CustomerImage = JSON.parse(existing.CustomerImage);
      } catch {
        CustomerImage = [];
      }
    }
    if (typeof existing.SitePlan === "string") {
      try {
        SitePlan = JSON.parse(existing.SitePlan);
      } catch {
        SitePlan = [];
      }
    }

    // REMOVE SPECIFIC CUSTOMER IMAGES
    if (updateData.removedCustomerImages.length > 0) {
      await Promise.all(
        updateData.removedCustomerImages.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          if (publicId)
            return cloudinary.uploader.destroy(
              `customer/customer_images/${publicId}`
            );
        })
      );

      CustomerImage = CustomerImage.filter(
        (img) => !updateData.removedCustomerImages.includes(img)
      );
    }

    // REMOVE SPECIFIC SITE PLANS
    if (updateData.removedSitePlans.length > 0) {
      await Promise.all(
        updateData.removedSitePlans.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          if (publicId)
            return cloudinary.uploader.destroy(
              `customer/site_plans/${publicId}`
            );
        })
      );

      SitePlan = SitePlan.filter(
        (img) => !updateData.removedSitePlans.includes(img)
      );
    }

    // REMOVE ALL CUSTOMER IMAGES
    if (
      updateData.CustomerImage !== undefined &&
      Array.isArray(updateData.CustomerImage) &&
      updateData.CustomerImage.length === 0
    ) {
      await Promise.all(
        CustomerImage.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          if (publicId)
            return cloudinary.uploader.destroy(
              `customer/customer_images/${publicId}`
            );
        })
      );
      CustomerImage = [];
    }

    // REMOVE ALL SITE PLANS
    if (
      updateData.SitePlan !== undefined &&
      Array.isArray(updateData.SitePlan) &&
      updateData.SitePlan.length === 0
    ) {
      await Promise.all(
        SitePlan.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          if (publicId)
            return cloudinary.uploader.destroy(
              `customer/site_plans/${publicId}`
            );
        })
      );
      SitePlan = [];
    }

    // UPLOAD NEW CUSTOMER IMAGES
    if (req.files?.CustomerImage) {
      const uploads = req.files.CustomerImage.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "customer/customer_images",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );

      CustomerImage.push(...(await Promise.all(uploads)));
    }

    // UPLOAD NEW SITE PLANS
    if (req.files?.SitePlan) {
      const uploads = req.files.SitePlan.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "customer/site_plans",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );

      SitePlan.push(...(await Promise.all(uploads)));
    }

    // SAVE FINAL IMAGE ARRAYS
    updateData.CustomerImage = JSON.stringify(CustomerImage);
    updateData.SitePlan = JSON.stringify(SitePlan);

    // Fix null relations
    if (updateData.AssignToId === "") updateData.AssignToId = null;
    if (updateData.CreatedById === "") updateData.CreatedById = null;

    // REMOVE NON-DB KEYS
    delete updateData.removedCustomerImages;
    delete updateData.removedSitePlans;
    delete updateData["removedCustomerImages "];
    delete updateData["removedSitePlans "];

    // ✅ BOOLEAN FIX — JUST THIS LINE
    updateData.isFavourite = toBoolean(updateData.isFavourite);
    updateData.isChecked = toBoolean(updateData.isChecked)

    const onlyIsChecked = Object.keys(req.body).length === 1 && 'isChecked' in req.body;

    if (!onlyIsChecked) {
      updateData.updatedAt = new Date(); // force updatedAt to change
    }

    /*     if (updateData.Price) {
          const PriceNumber = Number(
            updateData.Price.toString().replace(/[^0-9.]/g, "")
          )
    
          updateData.PriceNumber = PriceNumber;
        } */

    if (updateData.Price) {
      let raw = updateData.Price.toString().toLowerCase();

      let multiplier = 1;
      if (raw.includes("thousand") || raw.includes("thousands") || raw.includes("हज़ार")) {
        multiplier = 1000;
      }
      else if (raw.includes("crore") || raw.includes("cr")) {
        multiplier = 10000000;
      } else if (raw.includes("lakh") || raw.includes("lac") || raw.includes("l")) {
        multiplier = 100000;
      }

      const PriceNumber =
        Number(raw.replace(/[^0-9.]/g, "")) * multiplier;

      updateData.PriceNumber = PriceNumber;
    }

    // UPDATE CUSTOMER
    const updated = await prisma.customer.update({
      where: { id },
      data: updateData,
      include: { AssignTo: true, _count: { select: { shortlistedProperties: true } } },
    });

    logActivity({
      req, admin,
      action: "update",
      entity: "customer",
      entityId: updated.id,
      entityName: updated.customerName,
      customerId: updated.id,
      meta: { changed: diffFields(existing, updated) },
    });

    res.status(200).json({
      success: true,
      message: "Customer updated successfully",
      data: await transformGetCustomer(updated, admin),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// DELETE CUSTOMER
export const deleteCustomer = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { id } = req.params;

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return next(new ApiError(404, "Customer not found"));

    /*     if (admin.role !== "administrator") {
          if (existing.ClientId !== admin.clientId) {
            return next(
              new ApiError(403, "You cannot delete another company's customer")
            );
          }
        } */

    if (
      admin.role === "user" &&
      existing.AssignToId !== (admin._id || admin.id)
    )
      return next(new ApiError(403, "You can only delete your own customers"));
    if (admin.role === "city_admin" && existing.City !== admin.city)
      return next(
        new ApiError(403, "You can only delete customers in your city")
      );

    const CustomerImage = parseJSON(existing.CustomerImage);
    const SitePlan = parseJSON(existing.SitePlan);

    const deletions = [
      ...CustomerImage.map((url) =>
        cloudinary.uploader.destroy(
          `customer/customer_images/${getPublicIdFromUrl(url)}`
        )
      ),
      ...SitePlan.map((url) =>
        cloudinary.uploader.destroy(
          `customer/site_plans/${getPublicIdFromUrl(url)}`
        )
      ),
    ];

    await Promise.allSettled(deletions);

    await prisma.customer.delete({ where: { id } });

    logActivity({
      req, admin,
      action: "delete",
      entity: "customer",
      entityId: id,
      entityName: existing.customerName,
      customerId: id,
      meta: { contact: existing.ContactNumber, city: existing.City },
    });

    res.status(200).json({ message: "Customer deleted successfully" });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ASSIGN CUSTOMERS
export const assignCustomer = async (req, res, next) => {
  try {
    // ✅ NEW: action field — "assign" (default) or "remove"
    const { customerIds = [], assignToId, campaign, action = "assign" } = req.body;
    const admin = req.admin;

    // ✅ NEW: validate action value
    if (!["assign", "remove"].includes(action)) {
      return next(new ApiError(400, 'action must be "assign" or "remove"'));
    }

    if (!assignToId || !Array.isArray(assignToId) || assignToId.length === 0)
      return next(new ApiError(400, "assignToId is required"));

    // get admins
    const assignToAdmin = await prisma.admin.findMany({
      where: { id: { in: assignToId } },
      select: { id: true, role: true, clientId: true, city: true },
    });

    if (!assignToAdmin || assignToAdmin.length === 0)
      return next(new ApiError(404, "Admin/User not found"));

    // ------------------------------------------------
    // RESTRICTION: USER can only use selected IDs
    // (applies to both assign AND remove)
    // ------------------------------------------------
    const hasUser = assignToAdmin.some((a) => a.role === "user" || a.role === "agent");

    if (hasUser) {
      if (!customerIds.length || campaign) {
        return next(
          new ApiError(
            403,
            "You can only assign/remove selected customers for a user"
          )
        );
      }
    }

    if (customerIds.length && campaign) {
      return next(
        new ApiError(400, "Provide either customerIds or campaign, not both")
      );
    }

    if (admin.role !== "administrator") {
      const invalidAdmin = assignToAdmin.find(
        (a) => a.clientId !== admin.clientId
      );
      if (invalidAdmin) {
        return next(
          new ApiError(403, "You cannot assign customers to another company admin")
        );
      }
    }

    // ------------------------------------------------
    // BUILD FILTER
    // ------------------------------------------------
    let whereCondition = {};

    if (admin.role !== "administrator") {
      whereCondition.ClientId = admin.clientId;
    }

    if (customerIds.length > 0) {
      whereCondition.id = { in: customerIds };
    }

    if (campaign) {
      whereCondition.Campaign = campaign;
    }

    if (customerIds.length === 0 && !campaign)
      return next(new ApiError(400, "Provide customerIds or campaign"));

    const customers = await prisma.customer.findMany({
      where: whereCondition,
      include: { AssignTo: true },
    });

    if (customers.length === 0)
      return next(new ApiError(404, "No valid customers found"));

    // ------------------------------------------------
    // ROLE VALIDATION (Logged-in Admin Rules)
    // ------------------------------------------------
    if (admin.role === "city_admin") {
      const invalid = customers.filter((c) => c.City !== admin.city);
      if (invalid.length > 0)
        return next(
          new ApiError(403, "You can only assign customers in your city")
        );

      const invalidAssign = assignToAdmin.find((a) => a.city !== admin.city);
      if (invalidAssign)
        return next(
          new ApiError(403, "You can only assign to users in your city")
        );
    } else if (admin.role === "user" || admin.role === "agent") {
      return next(
        new ApiError(403, "Users are not allowed to assign customers")
      );
    }

    // ------------------------------------------------
    // UPDATE — ✅ connect OR disconnect based on action
    // ------------------------------------------------
    const prismaRelationAction = action === "remove" ? "disconnect" : "connect";

    const updates = customers.map((customer) =>
      prisma.customer.update({
        where: { id: customer.id },
        data: {
          AssignTo: {
            [prismaRelationAction]: assignToId.map((id) => ({ id })),
          },
        },
      })
    );

    await Promise.all(updates);

    // ---- assignment recency log ----
    try {
      const logIds = customers.map((c) => c.id);

      if (action === "remove") {
        await prisma.customerAssignLog.deleteMany({
          where: { customerId: { in: logIds }, adminId: { in: assignToId } },
        });
      } else {
        const now = new Date();
        await prisma.$transaction([
          prisma.customerAssignLog.deleteMany({
            where: { customerId: { in: logIds }, adminId: { in: assignToId } },
          }),
          prisma.customerAssignLog.createMany({
            data: logIds.flatMap((customerId) =>
              assignToId.map((adminId) => ({
                customerId,
                adminId,
                assignedById: admin.id || admin._id,
                assignedAt: now,
              }))
            ),
            skipDuplicates: true,
          }),
        ]);
      }

      await Promise.all(
        customers.map((c) =>
          logActivity({
            req, admin,
            action: action === "remove" ? "unassign" : "assign",
            entity: "customer",
            entityId: c.id,
            entityName: c.customerName,
            customerId: c.id,
            targetAdminId: assignToId[0],
            meta: { targetAdminIds: assignToId, campaign: campaign || null },
          })
        )
      );
    } catch (e) {
      console.error("assign log failed (non-fatal):", e.message);
    }

    const updated = await prisma.customer.findMany({
      where: whereCondition,
      include: { AssignTo: true },
    });

    // ✅ Dynamic message reflects the action taken
    const actionLabel = action === "remove" ? "Unassigned" : "Assigned";

    res.status(200).json({
      success: true,
      message: `${actionLabel} ${updated.length} customers successfully`,
      data: await Promise.all(updated.map(transformGetCustomer, admin)),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// BULK ASSIGN CITY CUSTOMERS
export const bulkAssignCityCustomers = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { assignToId } = req.body;
    if (admin.role !== "city_admin")
      return next(
        new ApiError(403, "Only City Admin can assign all city customers")
      );

    const targetAdmin = await prisma.admin.findUnique({
      where: { id: assignToId },
    });
    if (!targetAdmin)
      return next(new ApiError(404, "Target user/admin not found"));
    if (targetAdmin.city !== admin.city)
      return next(
        new ApiError(403, "You can only assign to users in your city")
      );

    const result = await prisma.customer.updateMany({
      where: { City: admin.city },
      data: { AssignToId: assignToId },
    });

    res.status(200).json({
      success: true,
      message: `Assigned ${result.count} customers to ${targetAdmin.name}`,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// GET FAVOURITES
export const getFavouriteCustomers = async (req, res, next) => {
  try {
    const admin = req.admin;
    let where = { isFavourite: true };


    if (admin.role !== "administrator" && admin.clientId) {
      where.ClientId = admin.clientId;
    }
    /* if (admin.role === "city_admin")
      where.City = { contains: admin.city, mode: "insensitive" };
    else if (admin.role === "user") where.AssignToId = admin._id || admin.id; */

    const favs = await prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    const transformed = await Promise.all(favs.map(transformGetCustomer, admin));
    res
      .status(200)
      .json({ success: true, count: transformed.length, data: transformed });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ✅ DELETE SELECTED OR ALL CUSTOMERS (Prisma version, same logic as MongoDB)
export const deleteAllCustomers = async (req, res, next) => {
  try {
    const admin = req.admin;
    if (admin.role !== "administrator")
      return next(new ApiError(403, "Only administrator can delete customers"));

    const { customerIds } = req.body;

    // Normalize IDs (string → array)
    let ids = customerIds;
    if (typeof ids === "string") {
      try {
        ids = JSON.parse(ids);
      } catch {
        ids = [];
      }
    }
    if (!Array.isArray(ids)) ids = [];

    let customersToDelete = [];

    if (ids.length > 0) {
      customersToDelete = await prisma.customer.findMany({
        where: { id: { in: ids } },
      });
      if (customersToDelete.length === 0)
        return next(new ApiError(404, "No valid customers found"));
    } else {
      customersToDelete = await prisma.customer.findMany();
      if (customersToDelete.length === 0)
        return next(new ApiError(404, "No customers found to delete"));
    }

    const deletions = [];

    for (const c of customersToDelete) {
      const CustomerImage = parseJSON(c.CustomerImage);
      const SitePlan = parseJSON(c.SitePlan);

      if (CustomerImage?.length) {
        deletions.push(
          ...CustomerImage.map((url) =>
            cloudinary.uploader.destroy(
              `customer/customer_images/${getPublicIdFromUrl(url)}`
            )
          )
        );
      }

      if (SitePlan?.length) {
        deletions.push(
          ...SitePlan.map((url) =>
            cloudinary.uploader.destroy(
              `customer/site_plans/${getPublicIdFromUrl(url)}`
            )
          )
        );
      }
    }

    await Promise.allSettled(deletions);

    // ======================================================
    // ✔ CORRECT FIX — delete Followups only
    // ======================================================
    if (ids.length > 0) {
      await prisma.followup.deleteMany({
        where: { customerId: { in: ids } },
      });
    } else {
      await prisma.followup.deleteMany({});
    }

    // Delete customers
    if (ids.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: ids } } });
    } else {
      await prisma.customer.deleteMany({});
    }

    res.status(200).json({
      success: true,
      message:
        ids.length > 0
          ? "Selected customers deleted successfully"
          : "All customers deleted successfully",
      deletedCustomerIds:
        ids.length > 0 ? ids : customersToDelete.map((c) => c.id),
    });
  } catch (error) {
    console.error("❌ DeleteAllCustomers Error:", error);
    next(new ApiError(500, error.message));
  }
};





// ------------------------------------------------------
//                RECOMMEND CUSTOMER (AI-AGENT)
// ------------------------------------------------------

export const getRecommendedCustomer = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { userPrompt, customerId } = req.body;

    if (!userPrompt) {
      return next(new ApiError(400, "userPrompt is required"));
    }

    if (!customerId) {
      return next(new ApiError(400, "customerId is required"));
    }

    const baseCustomer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!baseCustomer) {
      return next(new ApiError(404, "Customer not found"));
    }

    const followups = await prisma.followup.findMany({
      where: { customerId },
      orderBy: { createdAt: "asc" },
    });

    // --------------------------------------------
    // 🔥 AI FILTER GENERATION
    // --------------------------------------------

    const { tokens, fields, priceRange, answer, nearbyLocations } =
      await getRecommendedKeywordSearchData(
        userPrompt,
        baseCustomer,
        followups
      );

    let AND = [];

    // --------------------------------------------
    // ROLE-BASED FILTERS
    // --------------------------------------------

    if (admin.role !== "administrator" && admin.clientId) {
      AND.push({
        OR: [
          { ClientId: admin.clientId },
          { CreatedById: admin.id || admin._id }
        ]
      });
    }

    if (admin.role === "user") {
      const adminId = admin.id || admin._id;
      AND.push({
        OR: [
          { AssignTo: { some: { id: adminId } } },
          { CreatedById: adminId }
        ]
      });
    }

    else if (admin.role === "city_admin") {
      const adminId = admin.id || admin._id;

      const assignedCampaignsData = await prisma.customer.findMany({
        where: { AssignTo: { some: { id: adminId } } },
        select: { Campaign: true },
        distinct: ["Campaign"]
      });

      const assignedCampaigns = assignedCampaignsData
        .map(c => c.Campaign)
        .filter(Boolean);

      AND.push({
        OR: [
          { CreatedById: adminId },
          {
            AND: [
              { AssignTo: { some: { id: adminId } } },
              { City: { contains: admin.city } }
            ]
          },
          ...(assignedCampaigns.length > 0
            ? [{
              AND: [
                { Campaign: { in: assignedCampaigns } },
                { City: { contains: admin.city } }
              ]
            }]
            : [])
        ]
      });
    }

    // 1. Exclude the exact base customer record
    AND.push({
      id: { not: baseCustomer.id }
    });

    // 2. Exclude any other records sharing the exact same contact number
    if (baseCustomer.ContactNumber) {
      AND.push({
        ContactNumber: { not: baseCustomer.ContactNumber }
      });
    }

    // --------------------------------------------
    // EXCLUDE "OTHER" LOCATIONS
    // --------------------------------------------
    // Exclude location variations of "other/others" while keeping records where Location is null/empty
    AND.push({
      OR: [
        { Location: null },
        { Location: { notIn: ["other", "Other", "OTHER", "others", "Others", "OTHERS", "N/A", "n/a"] } }
      ]
    });

    // --------------------------------------------
    // 🔥 1. HARD FILTER: CAMPAIGN ONLY
    // --------------------------------------------

    // If Seller -> Get ALL Buyers. If Buyer -> Get ALL Sellers.
    if (baseCustomer.Campaign) {
      const currentCampaign = baseCustomer.Campaign.toLowerCase().trim();
      let targetCampaign = null;

      if (currentCampaign === "seller") {
        targetCampaign = "Buyer";
      } else if (currentCampaign === "buyer") {
        targetCampaign = "Seller";
      } else if (currentCampaign === "rent in") {
        targetCampaign = "Rent Out";
      } else if (currentCampaign === "rent out") {
        targetCampaign = "Rent In";
      }

      if (targetCampaign) {
        AND.push({
          Campaign: { contains: targetCampaign }
        });
      }
    }

    // --------------------------------------------
    // 🔥 2. HARD FILTER: PRICE (Optional)
    // --------------------------------------------

    if (priceRange?.min || priceRange?.max) {
      const min = priceRange?.min !== null
        ? Number(String(priceRange.min).replace(/[^0-9]/g, ""))
        : null;

      const max = priceRange?.max !== null
        ? Number(String(priceRange.max).replace(/[^0-9]/g, ""))
        : null;

      if (!isNaN(min) || !isNaN(max)) {
        AND.push({
          PriceNumber: {
            ...(min !== null && !isNaN(min) && { gte: min }),
            ...(max !== null && !isNaN(max) && { lte: max }),
          }
        });
      }
    }

    const where = AND.length ? { AND } : {};


    // --------------------------------------------
    // 🔥 FETCH ALL RELEVANT CUSTOMERS
    // --------------------------------------------
    // I REMOVED the token `WHERE` queries entirely so it fetches ALL your 250+ buyers
    // I REMOVED `distinct: ["ContactNumber"]` so it doesn't hide dummy/duplicate records

    let customers = await prisma.customer.findMany({
      where,
      include: { AssignTo: true }
    });

    // --------------------------------------------
    // 🔥 3. STRICT GEO & TYPE RANKING
    // --------------------------------------------

    const GEO_JUNK = new Set(["", "n/a", "na", "other", "others", "none", "null", "-", "unknown"]);
    const norm = (v) => String(v || "").toLowerCase().trim().replace(/\s+/g, " ");

    const safeString = (val) => {
      const n = norm(val);
      return GEO_JUNK.has(n) ? "" : n;
    };

    const baseCity = safeString(baseCustomer.City);

    /**
     * ⭐ THE CORE FIX.
     * Imported rows routinely repeat the city into Location/SubLocation
     * ("City: Jaipur, Location: Jaipur"). That is NOT a locality — treating it as
     * one made every Jaipur record look like an exact-location match and buried
     * the real Mansarovar↔Mansarovar hits. Anything that resolves to the city
     * name is demoted to "no locality specified".
     */
    const cityForms = new Set(
      baseCity ? [baseCity, `${baseCity} city`, `${baseCity} district`, `${baseCity} dist`, `${baseCity} rural`, `${baseCity} urban`] : []
    );
    const localityOf = (val, cityOfRow) => {
      const s = safeString(val);
      if (!s) return "";
      if (cityForms.has(s)) return "";
      if (cityOfRow && s === cityOfRow) return "";   // row's own Location == its own City
      return s;
    };

    const baseLoc = localityOf(baseCustomer.Location, baseCity);
    const baseSubLoc = localityOf(baseCustomer.SubLocation, baseCity);
    const baseType = safeString(baseCustomer.CustomerType);
    const baseSubType = safeString(baseCustomer.CustomerSubType);

    /** Substring match, but only between two REAL localities (handles "Mansarovar Extension"). */
    const geoHit = (a, b) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));

    /** Property families. A flat buyer should never be shown a commercial shop. */
    const familyOf = (type, sub) => {
      const s = `${safeString(type)} ${safeString(sub)}`;
      if (/\b(plot|land|farm|agricultur|khasra|bigha)\b/.test(s)) return "land";
      if (/\b(shop|office|commercial|showroom|warehouse|godown|industrial|hotel|restaurant)\b/.test(s)) return "commercial";
      if (/\b(flat|apartment|house|villa|bhk|residential|kothi|duplex|pg|room|floor)\b/.test(s)) return "residential";
      return "other";
    };
    const baseFamily = familyOf(baseCustomer.CustomerType, baseCustomer.CustomerSubType);

    // Tokens are for SOFT scoring only — never for geo rank. Letting "jaipur"
    // count as a location match is what made every record look exact.
    const safeTokens = (tokens || [])
      .map((t) => norm(t))
      .filter((t) => t.length > 2 && !cityForms.has(t));

    const safeNearbyLocations = (nearbyLocations || [])
      .map(norm)
      .filter((n) => n && !GEO_JUNK.has(n) && !cityForms.has(n) && n !== baseLoc && n !== baseSubLoc);

    customers = customers.map((customer) => {
      const custCity = safeString(customer.City);
      const custLoc = localityOf(customer.Location, custCity);
      const custSubLoc = localityOf(customer.SubLocation, custCity);

      const cityMatches = geoHit(custCity, baseCity);

      // ── GEO RANK: strict, base-customer only, no tokens ──
      let geoRank = 0;
      let geoLabel = "no-geo-match";

      const subHit = geoHit(custSubLoc, baseSubLoc) || geoHit(custSubLoc, baseLoc) || geoHit(custLoc, baseSubLoc);
      const locHit = geoHit(custLoc, baseLoc);
      const nearHit = safeNearbyLocations.some((n) => geoHit(custLoc, n) || geoHit(custSubLoc, n));

      if (cityMatches && subHit && locHit) { geoRank = 5; geoLabel = "exact-sublocation"; }
      else if (cityMatches && subHit) { geoRank = 4.5; geoLabel = "sublocation"; }
      else if (cityMatches && locHit) { geoRank = 4; geoLabel = "exact-location"; }
      else if (cityMatches && nearHit) { geoRank = 3; geoLabel = "nearby-location"; }
      else if (cityMatches) { geoRank = 2; geoLabel = "same-city-only"; }
      else if (subHit || locHit) { geoRank = 1; geoLabel = "location-no-city"; }
      else if (nearHit) { geoRank = 0.5; geoLabel = "nearby-no-city"; }

      // ── TYPE RANK ──
      const custType = safeString(customer.CustomerType);
      const custSubType = safeString(customer.CustomerSubType);
      const custFamily = familyOf(customer.CustomerType, customer.CustomerSubType);

      const typeMatches = geoHit(custType, baseType);
      const subTypeMatches = geoHit(custSubType, baseSubType);

      let typeRank = 0;
      if (typeMatches && subTypeMatches) typeRank = 3;
      else if (typeMatches) typeRank = 2;
      else if (subTypeMatches) typeRank = 1;

      // A flat buyer matched to a commercial shop is worse than a flat buyer in
      // the wrong locality — family outranks geography.
      const familyRank =
        baseFamily === "other" || custFamily === "other" ? 1 :
          custFamily === baseFamily ? 2 : 0;

      // ── SOFT SCORE: tokens live here, and only here ──
      let score = 0;
      if (safeTokens.length > 0) {
        const validFields = ["Description", "CustomerType", "CustomerSubType", "LeadType", "SubLocation", "Adderess", "Facillities"];
        safeTokens.forEach((t) => {
          if (validFields.some((f) => customer[f] && norm(customer[f]).includes(t))) score += 1;
        });
      }

      return { ...customer, _geoRank: geoRank, _geoLabel: geoLabel, _typeRank: typeRank, _familyRank: familyRank, _matchScore: score };
    });

    // Drop hard family mismatches entirely (set STRICT_FAMILY=false to only demote them).
    const STRICT_FAMILY = process.env.RECO_STRICT_FAMILY !== "false";
    if (STRICT_FAMILY && baseFamily !== "other") {
      customers = customers.filter((c) => c._familyRank > 0);
    }

    // Optional: hide pure "same city, nothing else" noise once you have real matches.
    const MIN_GEO = Number(process.env.RECO_MIN_GEO_RANK || 0);
    if (MIN_GEO > 0) {
      const strong = customers.filter((c) => c._geoRank >= MIN_GEO);
      if (strong.length >= 10) customers = strong;
    }

    // --- MULTI-LEVEL SORT ---
    customers.sort((a, b) => {
      if (b._familyRank !== a._familyRank) return b._familyRank - a._familyRank;
      if (b._geoRank !== a._geoRank) return b._geoRank - a._geoRank;
      if (b._typeRank !== a._typeRank) return b._typeRank - a._typeRank;
      if (b._matchScore !== a._matchScore) return b._matchScore - a._matchScore;
      return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
    });

    // --------------------------------------------
    // TRANSFORM & RESPONSE
    // --------------------------------------------

    const transformed = await Promise.all(
      customers.map(transformGetCustomer, admin)
    );

    res.status(200).json({
      success: true,
      count: transformed.length,
      data: transformed,
      aiAnswer: answer,
      appliedFilters: {
        tokens: safeTokens,
        nearbyLocations: safeNearbyLocations,
        baseFamily,
        baseGeo: { city: baseCity, location: baseLoc || "(city-only)", sublocation: baseSubLoc || "(none)" },
        priceRange
      }
    });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


// lead qualification agent

export const qualifyCustomer = async (req, res, next) => {
  try {
    const { userPrompt, customerId } = req.body;

    if (!userPrompt) {
      return next(new ApiError(400, "userPrompt is required"));
    }
    if (!customerId) {
      return next(new ApiError(400, "customerId is required"));
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      return next(new ApiError(404, "Customer not found"));
    }

    const followups = await prisma.followup.findMany({
      where: { customerId },
      orderBy: { createdAt: "asc" },
    });

    const userMessage = {
      customer: {
        name: customer.customerName,
        description: customer.Description,
        price: customer.PriceNumber,
        location: customer.Location,
      },
      followups: followups.map((f) => ({
        description: f.Description,
        startdate: f.StartDate,
        followupNextDate: f.FollowupNextDate,
        status: f.Status,
      })),
      userPrompt,
    }
    console.log("User message for agent:", JSON.stringify(userMessage, null, 2));
    const agentResponse = await QualifyAgent(userMessage);
    console.log("Agent response:", JSON.stringify(agentResponse, null, 2));

    // Call the agent function

    //dummy response
    res.status(200).json({
      success: true,
      message: "Customer qualified successfully",
      data: agentResponse,
    });

  }
  catch (error) {
    next(new ApiError(500, error.message));
  }
}

// data mining agent

export const dataMining = async (req, res, next) => {
  try {
    const now = new Date();

    const last7Days = new Date();
    last7Days.setDate(now.getDate() - 7);

    const last30Days = new Date();
    last30Days.setDate(now.getDate() - 30);

    // ================================
    // 1. TOTAL METRICS
    // ================================
    const [totalLeads7d, totalLeads30d, totalConversions7d] =
      await Promise.all([
        prisma.customer.count({
          where: { createdAt: { gte: last7Days } }
        }),
        prisma.customer.count({
          where: { createdAt: { gte: last30Days } }
        }),
        prisma.customer.count({
          where: {
            LeadTemperature: "hot",
            createdAt: { gte: last7Days }
          }
        })
      ]);

    const conversionRate =
      totalLeads7d > 0
        ? ((totalConversions7d / totalLeads7d) * 100).toFixed(2)
        : 0;

    // ================================
    // 2. CAMPAIGN PERFORMANCE (TOP 5)
    // ================================
    const [leadsByCampaign, conversionsByCampaign] =
      await Promise.all([
        prisma.customer.groupBy({
          by: ["Campaign"],
          where: { createdAt: { gte: last7Days } },
          _count: { id: true }
        }),
        prisma.customer.groupBy({
          by: ["Campaign"],
          where: {
            LeadTemperature: "hot",
            createdAt: { gte: last7Days }
          },
          _count: { id: true }
        })
      ]);

    const topCampaigns = leadsByCampaign
      .sort((a, b) => b._count.id - a._count.id)
      .slice(0, 5);

    const topConversions = conversionsByCampaign
      .sort((a, b) => b._count.id - a._count.id)
      .slice(0, 5);

    // ================================
    // 3. TOP CITIES (LIMITED)
    // ================================
    const leadsByCityRaw = await prisma.customer.groupBy({
      by: ["City"],
      where: { createdAt: { gte: last30Days } },
      _count: { id: true }
    });

    const topCities = leadsByCityRaw
      .sort((a, b) => b._count.id - a._count.id)
      .slice(0, 5);

    // ================================
    // 4. FUNNEL (COMPRESSED)
    // ================================
    const funnelRaw = await prisma.customer.groupBy({
      by: ["LeadTemperature"],
      _count: { id: true }
    });

    const funnel = {
      hot: 0,
      warm: 0,
      cold: 0
    };

    funnelRaw.forEach(f => {
      if (f.LeadTemperature === "hot") funnel.hot = f._count.id;
      if (f.LeadTemperature === "warm") funnel.warm = f._count.id;
      if (f.LeadTemperature === "cold") funnel.cold = f._count.id;
    });

    // ================================
    // 5. ENGAGEMENT (AGGREGATED ONLY)
    // ================================
    const [totalFollowups, totalCalls] = await Promise.all([
      prisma.followup.count({
        where: { createdAt: { gte: last7Days } }
      }),
      prisma.callLog.count({
        where: { createdAt: { gte: last7Days } }
      })
    ]);

    const avgFollowupsPerLead =
      totalLeads7d > 0
        ? (totalFollowups / totalLeads7d).toFixed(2)
        : 0;

    const avgCallsPerLead =
      totalLeads7d > 0
        ? (totalCalls / totalLeads7d).toFixed(2)
        : 0;

    // ================================
    // 6. BUDGET SEGMENTATION
    // ================================
    const budgets = await prisma.customer.findMany({
      where: { PriceNumber: { not: null } },
      select: { PriceNumber: true }
    });

    const budgetSegments = {
      "0-20L": 0,
      "20L-50L": 0,
      "50L-1Cr": 0,
      "1Cr+": 0
    };

    budgets.forEach(b => {
      const p = b.PriceNumber;
      if (p <= 2000000) budgetSegments["0-20L"]++;
      else if (p <= 5000000) budgetSegments["20L-50L"]++;
      else if (p <= 10000000) budgetSegments["50L-1Cr"]++;
      else budgetSegments["1Cr+"]++;
    });

    // ================================
    // FINAL AI INPUT (OPTIMIZED)
    // ================================
    const miningInput = {
      totals: {
        last7Days: {
          totalLeads: totalLeads7d,
          totalConversions: totalConversions7d,
          conversionRate
        },
        last30Days: {
          totalLeads: totalLeads30d
        }
      },

      campaigns: {
        topLeads: topCampaigns,
        topConversions: topConversions
      },

      locations: topCities,

      funnel,

      engagement: {
        avgFollowupsPerLead,
        avgCallsPerLead
      },

      budget: budgetSegments
    };

    console.log("AI Input:", JSON.stringify(miningInput, null, 2));

    const agentResponse = await DataMiningAgent(miningInput);

    res.status(200).json({
      success: true,
      data: agentResponse
    });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const startCall = async (req, res, next) => {
  try {
    const { userPrompt, customerId } = req.body;

    if (!userPrompt) {
      return next(new ApiError(400, "userPrompt is required"));
    }

    if (!customerId) {
      return next(new ApiError(400, "customerId is required"));
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });



    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }
    const followups = await prisma.followup.findMany({
      where: { customerId },
      orderBy: { createdAt: "asc" },
    });
    const userMessage = {
      customer: {
        name: customer.customerName,
        description: customer.Description,
        price: customer.PriceNumber,
        city: customer.City,
        location: customer.Location,
        campaign: customer.Campaign,
        customertype: customer.CustomerType,
        customersubtype: customer.CustomerSubType,
      },
      followups: followups.map((f) => ({
        description: f.Description,
        startdate: f.StartDate,
        followupNextDate: f.FollowupNextDate,
        status: f.Status,
      })),
      userPrompt,
    }

    const agentResponse = await CallingAgent(userMessage);
    /* console.log("Agent response for call instructions:", JSON.stringify(agentResponse, null, 2)); */

    const response = await fetch("https://www.tabbly.io/dashboard/agents/endpoints/trigger-call", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.TAPPLY_API_KEY}` // ✅ HERE
      },
      body: JSON.stringify({
        organization_id: process.env.TAPPLY_ORG_ID,
        use_agent_id: process.env.TAPPLY_CALL_AGENT_ID,
        called_to: `+91${customer.ContactNumber}`,
        call_from: `${process.env.TAPPLY_CALLER_NUMBER}`,
        custom_first_line: "",
        custom_instruction: agentResponse.callingPrompt,
        api_key: process.env.TAPPLY_API_KEY,
        custom_identifiers: "",
      })
    });

    const data = await response.json();

    if (data.success) {
      await prisma.callLog.create({
        data: {
          participantIdentity: data.participant_identity,
        }
      });
    }


    return res.status(200).json({
      success: true,
      message: "Call instructions generated successfully",
      data: agentResponse,
      callingdata: data
    });

  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Call failed" });
  }
};

export const getCallLogs = async (req, res) => {
  try {
    const response = await fetch(
      `https://www.tabbly.io/dashboard/agents/endpoints/call-logs-v2?api_key=${process.env.TAPPLY_API_KEY}&organization_id=2454`, // ⚠️ replace with real endpoint
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        }
      }
    );

    //console.log("STATUS:", response.status);

    const text = await response.text();
    // console.log("RAW RESPONSE:", text);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        message: "Invalid JSON from Tapply",
        raw: text
      });
    }

    return res.json(data);

  } catch (error) {
    console.log("ERROR:", error);
    return res.status(500).json({
      message: "Failed to fetch call logs"
    });
  }
};

export const getCallReport = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    let where = {};

    if (keyword) {
      where.Name = { contains: keyword, mode: "insensitive" };
    }

    const report = await prisma.callLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ? Number(limit) : undefined,
    });
    res.status(200).json({
      success: true,
      count: report.length,
      data: report,
    });
  }
  catch (error) {
    next(new ApiError(500, error.message));
  }
}

export const deleteCallLogById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: "ID is required" });
    }

    const deletedLog = await prisma.callLog.delete({
      where: {
        id: String(id), // adjust if your id is number
      },
    });

    return res.status(200).json({
      message: "Call log deleted successfully",
      data: deletedLog,
    });
  } catch (error) {
    console.error("Delete by ID error:", error);

    // Prisma specific error (record not found)
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Call log not found" });
    }

    return res.status(500).json({ message: "Internal server error" });
  }
};

export const syncCallLogs = async (req, res) => {
  try {
    const response = await fetch(
      `https://www.tabbly.io/dashboard/agents/endpoints/call-logs-v2?api_key=${process.env.TAPPLY_API_KEY}&organization_id=2454`
    );

    const data = await response.json();

    if (!data?.data) {
      return res.status(400).json({ message: "Invalid Tabbly response" });
    }

    for (const log of data.data) {
      const normalizedPhone = log.called_to?.slice(-10);

      await prisma.callLog.upsert({
        where: {
          participantIdentity: log.participant_identity,
        },

        update: {
          agentId: log.use_agent_id,
          organizationId: String(log.organization_id),

          calledTo: log.called_to,
          normalizedPhone,

          callDirection: log.call_direction,
          callStatus: log.call_status,
          callDuration: log.call_duration || 0,

          startTime: log.start_time ? new Date(log.start_time) : null,
          endTime: log.end_time ? new Date(log.end_time) : null,
          calledTime: log.created_at ? new Date(log.created_at) : null,

          recordingUrl: log.recording_url,

          transcript: log.transcript,
          summary: log.summary,
          sentiment: log.sentiment,

          totalCallCost: log.total_cost,
          telcoPricing: log.telco_cost,
          agentCost: log.agent_cost,

          rawJson: log,
        },

        create: {
          participantIdentity: log.participant_identity,

          agentId: log.use_agent_id,
          organizationId: String(log.organization_id),

          calledTo: log.called_to,
          normalizedPhone,

          callDirection: log.call_direction,
          callStatus: log.call_status,
          callDuration: log.call_duration || 0,

          startTime: log.start_time ? new Date(log.start_time) : null,
          endTime: log.end_time ? new Date(log.end_time) : null,
          calledTime: log.created_at ? new Date(log.created_at) : null,

          recordingUrl: log.recording_url,

          transcript: log.transcript,
          summary: log.summary,
          sentiment: log.sentiment,

          totalCallCost: log.total_cost,
          telcoPricing: log.telco_cost,
          agentCost: log.agent_cost,

          rawJson: log,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Call logs synced successfully",
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Sync failed",
    });
  }
};

//deal closing controllers 

// ─── Close a Deal ─────────────────────────────────────────────────────────────
export const closeDeal = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { id } = req.params;

    // check customer exists
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

    // role-based access — only allow if admin created it, assigned to it, or is administrator
    const adminId = admin.id || admin._id;
    const isAdministrator = admin.role === "administrator";
    const isCreator = customer.CreatedById === adminId;
    const isAssigned = await prisma.customer.findFirst({
      where: {
        id,
        AssignTo: { some: { id: adminId } }
      }
    });

    if (!isAdministrator && !isCreator && !isAssigned) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: {
        DealClosed: true,
        updatedAt: new Date(),
      },
    });

    return res.status(200).json({ success: true, data: updated });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


// ─── Reopen a Deal (undo close) ───────────────────────────────────────────────
export const reopenDeal = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

    // only administrator can reopen
    if (admin.role !== "administrator") {
      return res.status(403).json({ success: false, message: "Only administrators can reopen deals" });
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: {
        DealClosed: false,
        updatedAt: new Date(),
      },
    });

    return res.status(200).json({ success: true, data: updated });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


// ─── Get Closed Deals ─────────────────────────────────────────────────────────
export const getClosedDeals = async (req, res, next) => {
  try {
    const admin = req.admin;

    const {
      Campaign, City, Location, Keyword,
      StartDate, EndDate,
      Limit, Skip = 0,
    } = req.query;

    const offset = Number(Skip);
    let AND = [{ DealClosed: true }]; // ← only closed deals

    // ── Role-based access (same logic as getCustomer) ──────────────────────
    if (admin.role !== "administrator" && admin.clientId) {
      AND.push({
        OR: [
          { ClientId: admin.clientId },
          { CreatedById: admin.id || admin._id }
        ]
      });
    }

    if (admin.role === "user") {
      const adminId = admin.id || admin._id;
      AND.push({
        OR: [
          { AssignTo: { some: { id: adminId } } },
          { CreatedById: adminId }
        ]
      });
    }

    if (admin.role === "city_admin") {
      AND.push({ City: { equals: admin.city } });
    }

    // ── Basic filters ──────────────────────────────────────────────────────
    if (Campaign) AND.push({ Campaign: { contains: Campaign.trim() } });
    if (City) AND.push({ City: { contains: City.trim() } });
    if (Location) AND.push({ Location: { contains: Location.trim() } });

    // ── Keyword search ─────────────────────────────────────────────────────
    if (Keyword) {
      const tokens = Keyword.trim().split(" ").filter(Boolean);
      const fields = ["customerName", "ContactNumber", "City", "Location", "Campaign", "Description"];

      AND.push({
        AND: tokens.map((t) => ({
          OR: fields.map((field) => ({ [field]: { contains: t } })),
        })),
      });
    }

    const where = { AND };

    // ── Total count ────────────────────────────────────────────────────────
    const total = await prisma.customer.count({ where });

    // ── Fetch ──────────────────────────────────────────────────────────────
    let customers = await prisma.customer.findMany({
      where,
      orderBy: [
        { updatedAt: "desc" },
        { createdAt: "desc" },
      ],
      skip: offset,
      take: Limit !== undefined ? Number(Limit) : undefined,
      include: { AssignTo: true },
    });

    // ── Date range filter (same pattern as getCustomer) ────────────────────
    if (StartDate && EndDate) {
      const parseDMY = (str) => {
        if (!str) return null;
        const parts = str.split("-");
        if (parts.length !== 3) return null;
        let day, month, year;
        if (parts[0].length === 4) [year, month, day] = parts.map(Number);
        else[day, month, year] = parts.map(Number);
        const d = new Date(year, month - 1, day);
        d.setHours(0, 0, 0, 0);
        return isNaN(d.getTime()) ? null : d;
      };

      const start = parseDMY(StartDate);
      const end = parseDMY(EndDate);

      if (start && end) {
        end.setHours(23, 59, 59, 999);
        customers = customers.filter((c) => {
          const d = parseDMY(c.CustomerDate);
          return d && d >= start && d <= end;
        });
      }
    }

    // ── Transform ──────────────────────────────────────────────────────────
    const transformed = await Promise.all(customers.map(transformGetCustomer, admin));

    return res.status(200).json({
      success: true,
      total,
      count: transformed.length,
      data: transformed,
    });

  } catch (error) {
    console.log(" what/s this ", error)
    next(new ApiError(500, error.message));
  }
};


//saved properties shortlist for individual customer

// Helper to generate Role-Based Access Control filters
const getRbacFilters = async (admin, prisma) => {
  let AND = [];
  const adminId = admin.id || admin._id;

  if (admin.role !== "administrator" && admin.clientId) {
    AND.push({
      OR: [
        { ClientId: admin.clientId },
        { CreatedById: adminId }
      ]
    });
  }

  if (admin.role === "user") {
    AND.push({
      OR: [
        { AssignTo: { some: { id: adminId } } },
        { CreatedById: adminId }
      ]
    });
  } else if (admin.role === "city_admin") {
    const assignedCampaignsData = await prisma.customer.findMany({
      where: { AssignTo: { some: { id: adminId } } },
      select: { Campaign: true },
      distinct: ["Campaign"]
    });

    const assignedCampaigns = assignedCampaignsData.map(c => c.Campaign).filter(Boolean);

    AND.push({
      OR: [
        { CreatedById: adminId },
        {
          AND: [
            { AssignTo: { some: { id: adminId } } },
            { City: { contains: admin.city } }
          ]
        },
        ...(assignedCampaigns.length > 0 ? [{
          AND: [
            { Campaign: { in: assignedCampaigns } },
            { City: { contains: admin.city } }
          ]
        }] : [])
      ]
    });
  }

  return AND;
};


// ------------------------------------------------------
//             BULK ADD PROPERTIES TO SHORTLIST
// ------------------------------------------------------
export const addPropertiesToShortlist = async (req, res, next) => {
  try {
    const admin = req.admin;
    const adminId = admin.id || admin._id;
    const { customerId, propertyIds, status } = req.body;

    if (!customerId || !propertyIds || !Array.isArray(propertyIds) || propertyIds.length === 0) {
      return next(new ApiError(400, "customerId and a non-empty propertyIds array are required"));
    }

    const rbacFilters = await getRbacFilters(admin, prisma);

    // 1. RBAC CHECK: Does this admin have access to the base customer?
    const baseCustomer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        AND: rbacFilters.length ? rbacFilters : undefined
      }
    });

    if (!baseCustomer) {
      return next(new ApiError(403, "You do not have permission to modify this customer or it does not exist"));
    }

    // --------------------------------------------
    // 🔥 PREVENT DUPLICATES LOGIC
    // --------------------------------------------

    // 2. Fetch properties from the incoming array that are ALREADY shortlisted for this customer
    const existingShortlists = await prisma.propertyShortlist.findMany({
      where: {
        customerId: customerId,
        propertyId: { in: propertyIds } // Only check the IDs we are trying to add
      },
      select: { propertyId: true }
    });

    // 3. Extract just the IDs of the already existing properties
    const existingPropertyIds = existingShortlists.map(item => item.propertyId);

    // 4. Filter the incoming propertyIds to ONLY include new ones
    const newPropertyIds = propertyIds.filter(id => !existingPropertyIds.includes(id));

    // 5. If everything was already shortlisted, stop early and return a success response
    if (newPropertyIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: "All selected properties are already in the shortlist.",
        count: 0
      });
    }

    // --------------------------------------------
    // PROCEED WITH INSERTING ONLY NEW PROPERTIES
    // --------------------------------------------

    // 6. Prepare bulk insert data using the FILTERED array
    const insertData = newPropertyIds.map(propertyId => ({
      customerId,
      propertyId,
      status: status || "shortlisted",
      savedById: adminId,
    }));

    // 7. Bulk Insert
    const result = await prisma.propertyShortlist.createMany({
      data: insertData,
      skipDuplicates: true // Keeping this as an extra safety net
    });

    res.status(201).json({
      success: true,
      message: `Successfully saved ${result.count} new properties to the shortlist.`,
      count: result.count,
      alreadyExisted: existingPropertyIds.length // Optional: Let the frontend know how many were skipped
    });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};



// ------------------------------------------------------
//               GET CUSTOMER SHORTLIST
// ------------------------------------------------------
export const getCustomerShortlist = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { customerId } = req.params;

    if (!customerId) {
      return next(new ApiError(400, "customerId is required"));
    }

    const rbacFilters = await getRbacFilters(admin, prisma);

    // 1. RBAC CHECK: Does this admin have access to the base customer?
    const baseCustomer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        AND: rbacFilters.length ? rbacFilters : undefined
      }
    });

    if (!baseCustomer) {
      return next(new ApiError(403, "You do not have permission to view this customer's data"));
    }

    // 2. FETCH SHORTLIST + PROPERTIES (Applying RBAC to the included properties too)
    const shortlists = await prisma.propertyShortlist.findMany({
      where: {
        customerId,
        // Only fetch shortlisted items where the admin ALSO has access to the property itself
        property: {
          AND: rbacFilters.length ? rbacFilters : undefined
        }
      },
      include: {
        property: {
          include: { AssignTo: true }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    // 3. TRANSFORM DATA
    const transformedProperties = await Promise.all(
      shortlists.map(async (item) => {
        const transformedProperty = await transformGetCustomer(item.property, admin);
        return {
          ...transformedProperty,
          _shortlistInfo: {
            shortlistId: item.id,
            status: item.status,
            savedAt: item.createdAt,
            savedById: item.savedById
          }
        };
      })
    );

    res.status(200).json({
      success: true,
      count: transformedProperties.length,
      data: transformedProperties
    });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


// ------------------------------------------------------
//         BULK REMOVE PROPERTIES FROM SHORTLIST
// ------------------------------------------------------
export const removePropertiesFromShortlist = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { customerId, propertyIds } = req.body;

    if (!customerId || !propertyIds || !Array.isArray(propertyIds)) {
      return next(new ApiError(400, "customerId and propertyIds array are required"));
    }

    const rbacFilters = await getRbacFilters(admin, prisma);

    // 1. RBAC CHECK
    const baseCustomer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        AND: rbacFilters.length ? rbacFilters : undefined
      }
    });

    if (!baseCustomer) {
      return next(new ApiError(403, "Permission denied"));
    }

    // 2. Bulk Delete
    const result = await prisma.propertyShortlist.deleteMany({
      where: {
        customerId: customerId,
        propertyId: { in: propertyIds }
      }
    });

    res.status(200).json({
      success: true,
      message: `Removed ${result.count} properties from the shortlist.`
    });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


// ------------------------------------------------------
//            UPDATE SHORTLIST STATUS
// ------------------------------------------------------
export const updateShortlistStatus = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { customerId, propertyIds, status } = req.body;

    if (!customerId || !propertyIds || !Array.isArray(propertyIds) || !status) {
      return next(new ApiError(400, "customerId, propertyIds array, and status are required"));
    }

    const rbacFilters = await getRbacFilters(admin, prisma);

    // 1. RBAC CHECK
    const baseCustomer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        AND: rbacFilters.length ? rbacFilters : undefined
      }
    });

    if (!baseCustomer) {
      return next(new ApiError(403, "Permission denied"));
    }

    // 2. Bulk Update Status
    const result = await prisma.propertyShortlist.updateMany({
      where: {
        customerId: customerId,
        propertyId: { in: propertyIds }
      },
      data: {
        status: status
      }
    });

    res.status(200).json({
      success: true,
      message: `Status updated to '${status}' for ${result.count} properties.`
    });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


// archieve customer

// ─── Archive Customers (single or multiple) ──────────────
export const archiveCustomer = async (req, res, next) => {
  try {
    const admin = req.admin;
    const adminId = admin.id || admin._id;

    // Accept from body, fallback to params for backward compatibility
    let customerIds = req.body.customerIds || (req.params.id ? [req.params.id] : []);

    // Normalize string to array
    if (typeof customerIds === "string") {
      try {
        customerIds = JSON.parse(customerIds);
      } catch {
        customerIds = [];
      }
    }

    if (!Array.isArray(customerIds) || customerIds.length === 0) {
      return res.status(400).json({ success: false, message: "No customer IDs provided" });
    }

    // Prepare data payload for bulk insert
    const archiveData = customerIds.map((id) => ({
      customerId: id,
      adminId: adminId,
    }));

    // createMany with skipDuplicates prevents unique constraint errors on double-clicks
    const archived = await prisma.customerArchive.createMany({
      data: archiveData,
      skipDuplicates: true,
    });

    return res.status(200).json({
      success: true,
      count: archived.count,
      message: `${archived.count} customer(s) archived`
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ─── Unarchive Customers (single or multiple) ───────
export const unarchiveCustomer = async (req, res, next) => {
  try {
    const admin = req.admin;
    const adminId = admin.id || admin._id;

    let customerIds = req.body.customerIds || (req.params.id ? [req.params.id] : []);

    if (typeof customerIds === "string") {
      try {
        customerIds = JSON.parse(customerIds);
      } catch {
        customerIds = [];
      }
    }

    if (!Array.isArray(customerIds) || customerIds.length === 0) {
      return res.status(400).json({ success: false, message: "No customer IDs provided" });
    }

    const unarchived = await prisma.customerArchive.deleteMany({
      where: {
        customerId: { in: customerIds },
        adminId
      },
    });

    return res.status(200).json({
      success: true,
      count: unarchived.count,
      message: `${unarchived.count} customer(s) unarchived`
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ─── Get My Archived Customers ────────────────────────────────────────────────
export const getArchivedCustomers = async (req, res, next) => {
  try {
    const admin = req.admin;
    const adminId = admin.id || admin._id;

    const {
      Campaign, City, Location, Keyword,
      StartDate, EndDate,
      Limit, Skip = 0,
    } = req.query;

    const offset = Number(Skip);
    let AND = [{ archivedBy: { some: { adminId } } }]; // only this admin's archived customers

    if (Campaign) AND.push({ Campaign: { contains: Campaign.trim() } });
    if (City) AND.push({ City: { contains: City.trim() } });
    if (Location) AND.push({ Location: { contains: Location.trim() } });

    if (Keyword) {
      const tokens = Keyword.trim().split(" ").filter(Boolean);
      const fields = ["customerName", "ContactNumber", "City", "Location", "Campaign", "Description"];
      AND.push({
        AND: tokens.map((t) => ({
          OR: fields.map((field) => ({ [field]: { contains: t } })),
        })),
      });
    }

    const where = { AND };

    const total = await prisma.customer.count({ where });

    let customers = await prisma.customer.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: offset,
      take: Limit !== undefined ? Number(Limit) : undefined,
      include: {
        AssignTo: true,
        archivedBy: { where: { adminId }, select: { createdAt: true } }, // so you can show "archived 2d ago"
      },
    });

    if (StartDate && EndDate) {
      const parseDMY = (str) => {
        if (!str) return null;
        const parts = str.split("-");
        if (parts.length !== 3) return null;
        let day, month, year;
        if (parts[0].length === 4) [year, month, day] = parts.map(Number);
        else[day, month, year] = parts.map(Number);
        const d = new Date(year, month - 1, day);
        d.setHours(0, 0, 0, 0);
        return isNaN(d.getTime()) ? null : d;
      };
      const start = parseDMY(StartDate);
      const end = parseDMY(EndDate);
      if (start && end) {
        end.setHours(23, 59, 59, 999);
        customers = customers.filter((c) => {
          const d = parseDMY(c.CustomerDate);
          return d && d >= start && d <= end;
        });
      }
    }

    const transformed = await Promise.all(customers.map(transformGetCustomer));

    return res.status(200).json({
      success: true,
      total,
      count: transformed.length,
      data: transformed,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};












//customer portal controllers 



// Utility to generate token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// ---------------------------------------------
// CUSTOMER LOGIN
// ---------------------------------------------
export const customerLogin = async (req, res, next) => {
  try {
    const { Email, Password } = req.body;

    if (!Email || !Password) throw new ApiError(400, "Missing login details");

    const customer = await prisma.customer.findFirst({
      where: { Email },
    });

    if (!customer || !customer.Password) {
      throw new ApiError(404, "Client account not found or access not granted");
    }

    const isPasswordCorrect = await bcrypt.compare(Password, customer.Password);
    if (!isPasswordCorrect) throw new ApiError(401, "Invalid credentials");

    const token = generateToken(customer.id);

    // Set cookie
    res.cookie("customerToken", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(200).json({
      success: true,
      customer: {
        id: customer.id,
        name: customer.customerName,
        email: customer.Email,
      },
      token,
      message: "Login successful",
    });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

// ---------------------------------------------
// CHECK CUSTOMER AUTHENTICATION
// ---------------------------------------------
export const checkCustomerAuth = async (req, res, next) => {
  try {
    // req.customer is populated by protectCustomerRoute
    res.status(200).json({
      success: true,
      customer: {
        id: req.customer.id,
        name: req.customer.customerName,
        email: req.customer.Email,
        CustomerImage: req.customer.CustomerImage
      }
    });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

// ---------------------------------------------
// LOGOUT CUSTOMER
// ---------------------------------------------
export const customerLogout = async (req, res, next) => {
  try {
    res.cookie("customerToken", "", {
      httpOnly: true,
      expires: new Date(0),
    });

    res.status(200).json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};


// ---------------------------------------------
// GET CUSTOMER DASHBOARD DATA
// ---------------------------------------------
export const getCustomerPortalData = async (req, res, next) => {
  try {
    const customerId = req.customer.id;

    const portalData = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        // 1) NEW: the Admin assigned to this customer (account manager)
        AssignTo: {
          select: { name: true, email: true, phone: true, AdminImage: true },
          take: 1
        },

        // Employees assigned to this client
        assignedTeam: {
          select: {
            id: true,
            employeeName: true,
            Designation: true,
            Role: true,
            EmployeeImage: true,
            Email: true
          }
        },

        // Tasks attached to this client's project
        projectTasks: {
          include: {
            assignedTo: { select: { employeeName: true, EmployeeImage: true } },
            subTasks: { orderBy: { createdAt: 'asc' } }
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!portalData) {
      throw new ApiError(404, "Portal data not found");
    }

    res.status(200).json({
      success: true,
      data: {
        clientName: portalData.customerName,
        // 2) NEW: first assigned admin, or null if none
        accountManager: portalData.AssignTo[0] ?? null,
        assignedTeam: portalData.assignedTeam,
        tasks: portalData.projectTasks
      }
    });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};



const updateTaskSelect = {
  id: true, title: true, createdAt: true,
  assignedTo: { select: { employeeName: true, EmployeeImage: true } },
};

// GET /updates?limit=20&before=<ISO date>
export const getProjectUpdates = async (req, res, next) => {
  try {
    const customerId = req.customer.id;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    let before = null;
    if (req.query.before) {
      before = new Date(req.query.before);
      if (isNaN(before.getTime())) throw new ApiError(400, "Invalid 'before' date");
    }

    const [subTasks, tasks] = await Promise.all([
      prisma.subTask.findMany({
        where: { task: { customerId }, status: { not: "todo" }, ...(before && { updatedAt: { lte: before } }) },
        orderBy: { updatedAt: "desc" },
        take: limit + 1,
        include: { task: { select: updateTaskSelect } },
      }),
      prisma.task.findMany({
        where: { customerId, ...(before && { createdAt: { lte: before } }) },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        select: updateTaskSelect,
      }),
    ]);

    const events = [...subTasks.map((s) => stepUpdate(s, s.task)), ...tasks.map(assignedUpdate)]
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

    const hasMore = events.length > limit;
    const updates = events.slice(0, limit);

    res.status(200).json({
      success: true,
      data: { updates, nextCursor: hasMore ? updates[updates.length - 1].createdAt : null },
    });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};