import xlsx from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import prisma from "../config/prismaClient.js"; // your Prisma client instance
import ApiError from "../utils/ApiError.js";
import { logActivity } from "../utils/activityLogger.js";

// ----------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Auto key mapping
const keyMap = {
  "customer name": "customerName",
  fullname: "customerName",
  name: "customerName",

  contactnumber: "ContactNumber",
  phone: "ContactNumber",
  mobile: "ContactNumber",

  email: "Email",
  city: "City",
  location: "Location",
  sublocation: "SubLocation",
  area: "Area",
  address: "Adderess",
  facilities: "Facillities",
  description: "Description",
  referenceid: "ReferenceId",
  price: "Price",
  url: "URL",
};

// Clean numbers
const cleanNumber = (num) => {
  if (!num) return "";
  return String(num)
    .trim()
    .replace(/[^0-9]/g, "");
};

// Extract phone numbers
const extractNumbers = (raw) => {
  if (!raw) return "";
  const nums = String(raw)
    .split(/[,/;|\-]/)
    .map(cleanNumber)
    .filter((n) => n.length >= 10);
  return [...new Set(nums)].join(",");
};

// Normalize row keys
const normalizeKeys = (row, manual = {}) => {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const lower = (key || "").toLowerCase().trim();
    const finalKey = manual[lower] || keyMap[lower] || key;
    out[finalKey] = value;
  }
  return out;
};

// -----------------------------
// Helper: trimming + safe checks
// -----------------------------
const safeTrim = (v) => {
  if (v === null || v === undefined) return "";
  return String(v).trim();
};


const excelDateToString = (value) => {
  if (!value) return null;

  // ✅ Case 1: Already a JS Date (most common)
  if (value instanceof Date) {
    const day = String(value.getDate()).padStart(2, "0");
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const year = value.getFullYear();
    return `${day}-${month}-${year}`;
  }

  // ✅ Case 2: Excel numeric date
  if (typeof value === "number") {
    const jsDate = new Date(Math.round((value - 25569) * 86400 * 1000));
    const day = String(jsDate.getDate()).padStart(2, "0");
    const month = String(jsDate.getMonth() + 1).padStart(2, "0");
    const year = jsDate.getFullYear();
    return `${day}-${month}-${year}`;
  }

  // ✅ Case 3: String date (already dd-mm-yyyy)
  if (typeof value === "string") {
    return value.trim();
  }

  return null;
};




// ------------------------------------------------------
// IMPORT CONTROLLER (with auto-create master records)
// ------------------------------------------------------
export const importCustomers = async (req, res, next) => {
  try {
    const admin = req.admin;

    if (!req.body.fieldMapping)
      return next(new ApiError(400, "fieldMapping is required"));

    // ----------------------------
    // Parse Manual Mapping
    // ----------------------------
    let manualMap = {};
    try {
      const parsed = JSON.parse(req.body.fieldMapping);
      Object.keys(parsed).forEach((key) => {
        manualMap[key.toLowerCase()] = parsed[key];
      });
    } catch {
      return next(new ApiError(400, "Invalid fieldMapping JSON"));
    }

    // ----------------------------
    // File check
    // ----------------------------
    if (!req.file) return next(new ApiError(400, "No file uploaded"));

    const workbook = xlsx.readFile(req.file.path, {
  cellDates: true,
});
    const sheetName = workbook.SheetNames[0];
    const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
  raw: false,
  dateNF: "dd-mm-yyyy",
});

    if (!sheet.length) return next(new ApiError(400, "Empty Excel file"));

    // ----------------------------
    // Normalize all rows
    // ----------------------------
    const normalized = sheet.map((row) => normalizeKeys(row, manualMap));

    const activeFields = await prisma.customerFields.findMany({
      where: { Status: "Active" },
      select: { Name: true },
    });

    const allowedCustomerFieldKeys = new Set(
      activeFields.map((f) => f.Name.toLowerCase())
    );


    // ----------------------------
    // Process rows
    // ----------------------------
    const processed = normalized.map((r) => {
      const cleanedContacts = extractNumbers(r.ContactNumber);
      const firstPhone = cleanedContacts ? cleanedContacts.split(",")[0] : "";

      const email = safeTrim(r.Email) || null;

      const customerFields = {};

      const prismaCustomerKeys = new Set([
        "campaign",
        "customertype",
        "customersubtype",
        "customername",
        "contactnumber",
        "city",
        "location",
        "sublocation",
        "area",
        "adderess",
        "email",
        "facillities",
        "description",
        "customerdate",
        "price",
        "url",
        "other",
        "referenceid",
        "customerid",
        "customeryear",
        "video",
        "verified",
        "googlemap"
      ]);

      for (const key in r) {
        const lowerKey = key.toLowerCase();

        // ✅ Only store as CustomerField if it's in allowed (active) fields
        if (allowedCustomerFieldKeys.has(lowerKey)) {
          customerFields[key] = safeTrim(r[key]);
          delete r[key]; // remove from main object
        }

        // ❌ Otherwise, just delete unknown keys from payload
        else if (!prismaCustomerKeys.has(lowerKey)) {
          delete r[key]; // skip/store nothing
        }
      }


      let PriceNumber = 0;
      if (r.Price) {

        /*    PriceNumber = Number(
         r.Price.toString().replace(/[^0-9.]/g, "")
       ) */
        const raw = r.Price.toString().toLowerCase();

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

      return {
        ...r,
        CustomerFields: customerFields,
        customerName: safeTrim(r.customerName || r.CustomerName || "") || "",
        ContactNumber: firstPhone,
        Email: email,
        City: safeTrim(r.City) || "",
        Location: safeTrim(r.Location) || "",
        SubLocation: safeTrim(r.SubLocation) || "",
        Area: safeTrim(r.Area) || "",
        Adderess: safeTrim(r.Adderess) || "",
        Facillities: safeTrim(r.Facillities) || "",
        Description: safeTrim(r.Description) || "",
        Campaign: safeTrim(r.Campaign) || "",
        CustomerType: safeTrim(r.CustomerType) || "",
        CustomerSubType: safeTrim(r.CustomerSubType) || "",
        CustomerDate: excelDateToString(r.CustomerDate),
        Price: safeTrim(r.Price) || "",
        PriceNumber: PriceNumber,
        URL: safeTrim(r.URL) || "",
        Other: safeTrim(r.Other) || "",
        ReferenceId: safeTrim(r.ReferenceId) || ""

      };
    });

    // --------------------------------------------------
    // Remove rows missing name or phone
    // --------------------------------------------------
    const valid = processed.filter((r) => r.customerName && r.ContactNumber);
    const invalidRows = processed.filter(
      (r) => !r.customerName || !r.ContactNumber
    );

    if (!valid.length)
      return next(
        new ApiError(
          400,
          `No valid data. ${invalidRows.length} invalid rows skipped.`
        )
      );

    // ----------------------------
    // Duplicate check (EMAIL ONLY)
    // ----------------------------
    /*  const emails = valid.map((v) => v.Email).filter(Boolean);
 
     const existing = await prisma.customer.findMany({
       where: {
         Email: { in: emails },
       },
       select: { Email: true },
     });
 
     const existingEmails = new Set(existing.map((e) => e.Email)); */

    // collect contact numbers from incoming rows
    const contactNumbers = valid.map((v) => v.ContactNumber);

    // find all existing customers with same contact numbers
    const existingByPhone = await prisma.customer.findMany({
      where: {
        ContactNumber: { in: contactNumbers },
      },
      select: { ContactNumber: true },
    });

    // store them in a Set for fast lookup
    const existingPhones = new Set(
      existingByPhone.map((e) => e.ContactNumber).filter(Boolean)
    );

    const imported = [];
    const duplicates = [];
    const failed = [];

    // ---------------------------------------------
    // CACHES to avoid repeated DB calls during import
    // key -> id (or boolean)
    // ---------------------------------------------
    const campaignCache = new Map(); // campaignName -> id
    const typeCache = new Map(); // `${campaignName}::${typeName}` -> id
    const subTypeCache = new Map(); // `${campaignName}::${typeName}::${subTypeName}` -> id
    const cityCache = new Map(); // cityName -> id
    const locationCache = new Map(); // `${cityName}::${locationName}` -> id
    const subLocationCache = new Map(); // `${cityName}::${locationName}::${subLocationName}` -> id
    const referenceIdCache = new Map();
    const leadTypeCache = new Map();

    // ---------------------------
    // Helper: Get or create Campaign
    // ---------------------------
    const getOrCreateCampaign = async (name) => {
      name = safeTrim(name);
      if (!name) return null;
      if (campaignCache.has(name)) return campaignCache.get(name);

      // Campaign.Name is unique in schema -> use findUnique
      const found = await prisma.campaign.findUnique({
        where: { Name: name },
        select: { id: true, Name: true },
      });

      if (found) {
        campaignCache.set(name, found.id);
        return found.id;
      }

      const created = await prisma.campaign.create({
        data: { Name: name },
      });

      campaignCache.set(name, created.id);
      return created.id;
    };

    // ---------------------------
    // Helper: Get or create Type (CustomerType) under campaign
    // ---------------------------
    const getOrCreateType = async (typeName, campaignName) => {
      typeName = safeTrim(typeName);
      campaignName = safeTrim(campaignName);
      if (!typeName) return null;

      const key = `${campaignName}::${typeName}`;
      if (typeCache.has(key)) return typeCache.get(key);

      // find campaignId first (if campaignName provided)
      let campaignId = null;
      if (campaignName) {
        campaignId = await getOrCreateCampaign(campaignName);
      }

      // Try to find existing type: Type has fields Name and campaignId
      // If campaignId is present, search by both; otherwise search by Name only
      const where = campaignId
        ? { Name_campaignId: { Name: typeName, campaignId } } // compound index doesn't exist - fallback to findFirst
        : null;

      // Prisma cannot use non-existing compound, so use findFirst
      const found = await prisma.type.findFirst({
        where: campaignId ? { Name: typeName, campaignId } : { Name: typeName },
        select: { id: true },
      });

      if (found) {
        typeCache.set(key, found.id);
        return found.id;
      }

      // Create type (require campaignId; if not present, create without linking? Schema requires campaignId non-null)
      // Schema: Type has campaignId String (non-null). So ensure campaignId exists (create default campaign if absent?)
      if (!campaignId) {
        // If user provided a typeName but no campaignName, create a generic campaign named "Default"
        campaignId = await getOrCreateCampaign("Default");
      }

      const created = await prisma.type.create({
        data: {
          Name: typeName,
          campaignId,
        },
      });

      typeCache.set(key, created.id);
      return created.id;
    };

    // ---------------------------
    // Helper: Get or create SubType under campaign and type
    // ---------------------------
    const getOrCreateSubType = async (subTypeName, campaignName, typeName) => {
      subTypeName = safeTrim(subTypeName);
      if (!subTypeName) return null;
      campaignName = safeTrim(campaignName);
      typeName = safeTrim(typeName);

      const key = `${campaignName}::${typeName}::${subTypeName}`;
      if (subTypeCache.has(key)) return subTypeCache.get(key);

      // Ensure campaign and type exist (and get their ids)
      const campaignId = campaignName
        ? await getOrCreateCampaign(campaignName)
        : await getOrCreateCampaign("Default");
      const typeId = await getOrCreateType(
        typeName || "Default",
        campaignName || "Default"
      );

      // Try findFirst
      const found = await prisma.subType.findFirst({
        where: { Name: subTypeName, campaignId, customerTypeId: typeId },
        select: { id: true },
      });

      if (found) {
        subTypeCache.set(key, found.id);
        return found.id;
      }

      const created = await prisma.subType.create({
        data: {
          Name: subTypeName,
          campaignId,
          customerTypeId: typeId,
        },
      });

      subTypeCache.set(key, created.id);
      return created.id;
    };

    // ---------------------------
    // Helper: Get or create City
    // ---------------------------
    const getOrCreateCity = async (name) => {
      name = safeTrim(name);
      if (!name) return null;
      if (cityCache.has(name)) return cityCache.get(name);

      const found = await prisma.city.findFirst({
        where: { Name: name },
        select: { id: true },
      });

      if (found) {
        cityCache.set(name, found.id);
        return found.id;
      }

      const created = await prisma.city.create({
        data: {
          Name: name,
          Status: "Active",
        },
      });

      cityCache.set(name, created.id);
      return created.id;
    };

    // ---------------------------
    // Helper: Get or create Location under city
    // ---------------------------
    const getOrCreateLocation = async (locationName, cityName) => {
      locationName = safeTrim(locationName);
      cityName = safeTrim(cityName);
      if (!locationName) return null;

      const key = `${cityName}::${locationName}`;
      if (locationCache.has(key)) return locationCache.get(key);

      // Ensure city exists
      const cityId = cityName ? await getOrCreateCity(cityName) : null;

      // If cityId is required by schema (Location.cityId is non-null), ensure we have one
      const effectiveCityId = cityId || (await getOrCreateCity("Default"));

      const found = await prisma.location.findFirst({
        where: { Name: locationName, cityId: effectiveCityId },
        select: { id: true },
      });

      if (found) {
        locationCache.set(key, found.id);
        return found.id;
      }

      const created = await prisma.location.create({
        data: {
          Name: locationName,
          cityId: effectiveCityId,
        },
      });

      locationCache.set(key, created.id);
      return created.id;
    };

    const getOrCreateSubLocation = async (subLocationName, locationName, cityName) => {
      subLocationName = safeTrim(subLocationName);
      locationName = safeTrim(locationName);
      cityName = safeTrim(cityName);
      if (!subLocationName) return null;

      const key = `${cityName}::${locationName}::${subLocationName}`;
      if (subLocationCache.has(key)) return subLocationCache.get(key);

      // Ensure city exists
      const cityId = cityName ? await getOrCreateCity(cityName) : await getOrCreateCity("Default");

      // Ensure location exists
      const locationId = locationName ? await getOrCreateLocation(locationName, cityName) : await getOrCreateLocation("Default", cityName || "Default");

      // Check if SubLocation already exists
      const found = await prisma.subLocation.findFirst({
        where: { Name: subLocationName, locationId },
        select: { id: true },
      });

      if (found) {
        subLocationCache.set(key, found.id);
        return found.id;
      }

      // Create SubLocation with both locationId and cityId
      const created = await prisma.subLocation.create({
        data: {
          Name: subLocationName,
          locationId,
          cityId, // ✅ this fixes the Prisma error
        },
      });

      subLocationCache.set(key, created.id);
      return created.id;
    };

    const getOrCreateReferenceId = async (ref) => {
      ref = safeTrim(ref);
      if (!ref) return null;

      // cache by name
      if (referenceIdCache.has(ref)) return ref;

      // Name is NOT unique → use findFirst
      const found = await prisma.reference.findFirst({
        where: { Name: ref },
        select: { id: true },
      });

      if (found) {
        referenceIdCache.set(ref, true);
        return ref;
      }

      // create new reference
      await prisma.reference.create({
        data: {
          Name: ref,
          Status: "Active", // ✅ REQUIRED
        },
      });

      referenceIdCache.set(ref, true);
      return ref;
    };

    const getOrCreateLeadType = async (leadtypename) => {
      leadtypename = safeTrim(leadtypename);
      if (!leadtypename) return null;

      // cache by name
      if (leadTypeCache.has(leadtypename)) return leadtypename;

      // Name is NOT unique → use findFirst
      const found = await prisma.leadType.findFirst({
        where: { Name: leadtypename },
        select: { id: true },
      });

      if (found) {
        leadTypeCache.set(leadtypename, true);
        return leadtypename;
      }

      // create new reference
      await prisma.leadType.create({
        data: {
          Name: leadtypename,
          Status: "Active", // ✅ REQUIRED
        },
      });

      leadTypeCache.set(leadtypename, true);
      return leadtypename;
    };




    // --------------------------------------------------
    // Insert one by one (safer) with master creation
    // --------------------------------------------------
    for (const row of valid) {
      // Duplicate check by email only
      /* if (row.Email && existingEmails.has(row.Email)) {
        duplicates.push(row);
        continue;
      } */
      // Duplicate check by ContactNumber
      const isDuplicate =
        row.ContactNumber && existingPhones.has(row.ContactNumber);

      if (isDuplicate) {
        duplicates.push(row);
        // ✔ DO NOT SKIP — duplicates should still be inserted
      }


      try {
        // Auto-create master records (but we only store strings on customer)
        // We'll create master entries if provided in row (non-empty)
        if (row.Campaign) {
          await getOrCreateCampaign(row.Campaign);
        }
        if (row.CustomerType) {
          await getOrCreateType(row.CustomerType, row.Campaign || "Default");
        }
        if (row.CustomerSubType) {
          await getOrCreateSubType(
            row.CustomerSubType,
            row.Campaign || "Default",
            row.CustomerType || "Default"
          );
        }
        if (row.City) {
          await getOrCreateCity(row.City);
        }
        if (row.Location) {
          await getOrCreateLocation(row.Location, row.City || "Default");
        }
        if (row.SubLocation) {
          await getOrCreateSubLocation(row.SubLocation, row.Location || "Default", row.City || "Default");
        }

        if (row.ReferenceId) {
          await getOrCreateReferenceId(row.ReferenceId);
        }

        if (row.leadType) {
          await getOrCreateLeadType(row.LeadType);
        }



        // Create customer (Customer stores strings as before)
        const created = await prisma.customer.create({
          data: {
            ...row,
            CustomerFields: row.CustomerFields,
            CreatedById: admin.id,
            City: row.City || admin.city || "",
            isImported: true,
            updatedAt: new Date(),
          },
        });

        imported.push({ ...row, id: created.id });

        //ACTIVITY LOG TRIGGER
        logActivity({
          req, 
          admin,
          action: "import", // Uses the new enum value
          entity: "customer",
          entityId: created.id,
          entityName: created.customerName,
          customerId: created.id,
          meta: { 
            method: "excel_bulk_import", 
            campaign: created.Campaign, 
            city: created.City 
          },
        });

        /*  if (row.Email) existingEmails.add(row.Email); */
        if (row.ContactNumber) existingPhones.add(row.ContactNumber);
      } catch (err) {
        console.log("IMPORT FAILED:", err);

        failed.push({ ...row, error: err.message });
      }
    }

    // --------------------------------------------------
    // Create Excel Summary
    // --------------------------------------------------
    const summaryDir = path.join(__dirname, "../uploads/summaries");
    if (!fs.existsSync(summaryDir))
      fs.mkdirSync(summaryDir, { recursive: true });

    const filePath = path.join(summaryDir, `summary-${Date.now()}.xlsx`);
    const wb = xlsx.utils.book_new();

    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.json_to_sheet(imported),
      "Imported"
    );
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.json_to_sheet(duplicates),
      "Duplicates"
    );
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.json_to_sheet(invalidRows),
      "Invalid"
    );
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.json_to_sheet(failed),
      "Failed"
    );

    xlsx.writeFile(wb, filePath);

    // cleanup
    fs.unlink(req.file.path, () => { });

    return res.status(200).json({
      success: true,
      message: `${imported.length} imported, ${duplicates.length} duplicates, ${invalidRows.length} invalid, ${failed.length} failed.`,
      imported: imported.length,
      duplicates: duplicates.length,
      invalid: invalidRows.length,
      failed: failed.length,
      file: `/uploads/summaries/${path.basename(filePath)}`,
    });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => { });
    next(new ApiError(500, err.message));
  }
};

// ------------------------------
// Read Excel Headers
// ------------------------------
export const readCustomerHeaders = async (req, res, next) => {
  try {
    if (!req.file) return next(new ApiError(400, "No file uploaded"));

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    fs.unlink(req.file.path, () => { });

    const headers = data[0] || [];
    if (!headers.length)
      return next(new ApiError(400, "No headers found in file"));

    res.status(200).json({
      success: true,
      message: "Headers extracted successfully",
      headers,
    });
  } catch (error) {
    if (req.file?.path) fs.unlink(req.file.path, () => { });
    next(new ApiError(500, error.message));
  }
};
