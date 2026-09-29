// controllers/controller.contactImport.js
import xlsx from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// file paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// key map (kept exactly same as your original)
const keyMap = {
  "contact no": "ContactNo",
  contactno: "ContactNo",
  mobile: "ContactNo",
  "mobile number": "ContactNo",
  phone: "ContactNo",
  "phone number": "ContactNo",

  fullname: "Name",
  "full name": "Name",
  "contact name": "Name",
  "person name": "Name",

  email: "Email",
  "e-mail": "Email",
  mail: "Email",

  city: "City",
  location: "Location",
  address: "Address",

  company: "CompanyName",
  "company name": "CompanyName",

  industry: "ContactIndustry",
  "functional area": "ContactFunctionalArea",

  notes: "Notes",
  facilities: "Facilities",
  "reference id": "ReferenceId",
  status: "Status",

  campaign: "Campaign",
  "campaign name": "Campaign",
  "campaign title": "Campaign",

  "contact type": "ContactType",
  "lead type": "ContactType",
  type: "ContactType",
};

// utils
const cleanNumber = (num) => {
  if (!num) return "";
  return String(num)
    .replace(/[^\d]/g, "")
    .replace(/^91/, "")
    .replace(/^0+/, "")
    .trim();
};

const extractNumbers = (raw) => {
  if (!raw) return "";
  const nums = String(raw)
    .split(/[,/|;:-]/)
    .map((n) => cleanNumber(n))
    .filter((n) => n.length >= 10);
  return [...new Set(nums)].join(",");
};

const normalizeKeys = (row, manualMap = {}) => {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    const lowerKey = (key || "").trim().toLowerCase();
    const manualKey = manualMap[lowerKey];
    const normalizedKey = manualKey || keyMap[lowerKey] || key;

    let finalValue = value;

    if (
      [
        "contactno",
        "contact number",
        "mobile",
        "mobile number",
        "phone",
        "phone number",
      ].includes(lowerKey)
    ) {
      finalValue = extractNumbers(value);
    }

    normalized[normalizedKey] = finalValue;
  }
  return normalized;
};

// -----------------------------
// Caches & helpers to create/get Campaign and ContactType
// -----------------------------
const campaignCache = new Map(); // name -> id
const contactTypeCache = new Map(); // `${campaignName}::${typeName}` -> id

const safeTrim = (v) => (typeof v === "string" ? v.trim() : v);

const getOrCreateCampaign = async (name) => {
  name = safeTrim(name);
  if (!name) return null;
  if (campaignCache.has(name)) return campaignCache.get(name);

  // find first by Name
  const found = await prisma.contactCampaign.findUnique({
    where: { Name: name },
    select: { id: true, Name: true },
  });

  if (found) {
    campaignCache.set(name, found.id);
    return found.id;
  }

  const created = await prisma.contactCampaign.create({
    data: { Name: name, Status: "Active" },
    select: { id: true, Name: true },
  });

  campaignCache.set(name, created.id);
  return created.id;
};

const getOrCreateContactType = async (typeName, campaignName) => {
  typeName = safeTrim(typeName);
  campaignName = safeTrim(campaignName);
  if (!typeName) return null;

  const key = `${campaignName}::${typeName}`;
  if (contactTypeCache.has(key)) return contactTypeCache.get(key);

  // ensure campaign exists if provided
  let campaignId = null;
  if (campaignName) {
    campaignId = await getOrCreateCampaign(campaignName);
  }

  // try find existing ContactType: if campaignId present, search by both
  const found = campaignId
    ? await prisma.contactType.findFirst({
        where: { Name: typeName, campaignId },
        select: { id: true },
      })
    : await prisma.contactType.findFirst({
        where: { Name: typeName },
        select: { id: true },
      });

  if (found) {
    contactTypeCache.set(key, found.id);
    return found.id;
  }

  // if schema requires campaignId (it does), ensure campaign exists (create Default if needed)
  if (!campaignId) {
    campaignId = await getOrCreateCampaign("Default");
  }

  const created = await prisma.contactType.create({
    data: {
      Name: typeName,
      campaignId,
      Status: "Active",
    },
    select: { id: true },
  });

  contactTypeCache.set(key, created.id);
  return created.id;
};

// ------------------------------
// Import Contacts Controller
// ------------------------------
export const importContacts = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { fieldMapping } = req.body;

    if (!fieldMapping)
      return next(new ApiError(400, "fieldMapping is required"));

    // parse manual mapping
    let manualMap = {};
    try {
      const parsed = JSON.parse(fieldMapping);
      for (const key of Object.keys(parsed)) {
        manualMap[key.trim().toLowerCase()] = parsed[key];
      }
    } catch (err) {
      return next(new ApiError(400, "Invalid fieldMapping JSON"));
    }

    if (!req.file) return next(new ApiError(400, "No file uploaded"));

    // read excel file
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!sheetData.length) {
      fs.unlink(req.file.path, () => {});
      return next(new ApiError(400, "Excel file is empty"));
    }

    const normalizedData = sheetData.map((row) =>
      normalizeKeys(row, manualMap)
    );

    const finalContacts = [];

    // normalize, ensure campaign + type (create masters if needed), prepare contacts
    for (const row of normalizedData) {
      if (!row.ContactNo || !row.Name) continue;

      // auto-create masters (but we only store names on Contact record)
      // create campaign and contactType if provided to keep parity with mongo create behavior
      if (row.Campaign) {
        await getOrCreateCampaign(row.Campaign);
      }
      if (row.ContactType) {
        await getOrCreateContactType(
          row.ContactType,
          row.Campaign || "Default"
        );
      }

      finalContacts.push({
        ...row,
        ContactNo: extractNumbers(row.ContactNo),
        Campaign: row.Campaign ? safeTrim(row.Campaign) : "",
        ContactType: row.ContactType ? safeTrim(row.ContactType) : "",
        City: admin.city || row.City || "",
        // keep other fields as-is (Address vs Address in keyMap)
        Address: row.Address || row.Address || "",
        CreatedBy: admin.id, // not stored in DB (schema has no CreatedById on Contact) — included for frontend compatibility
        isImported: true,
      });
    }

    if (!finalContacts.length) {
      fs.unlink(req.file.path, () => {});
      return next(
        new ApiError(400, "No valid contact records found in the file")
      );
    }

    // duplicate filtering by ContactNo
    const contactNumbers = finalContacts
      .map((c) => c.ContactNo)
      .filter(Boolean);

    const existingContacts = contactNumbers.length
      ? await prisma.contact.findMany({
          where: { ContactNo: { in: contactNumbers } },
          select: { ContactNo: true },
        })
      : [];

    const existingNumbers = new Set(existingContacts.map((c) => c.ContactNo));

    const uniqueContacts = finalContacts.filter(
      (c) => !existingNumbers.has(c.ContactNo)
    );

    const duplicateContacts = finalContacts.filter((c) =>
      existingNumbers.has(c.ContactNo)
    );

    // insert unique contacts one-by-one so we can return inserted objects with IDs
    const inserted = [];
    for (const c of uniqueContacts) {
      try {
        const created = await prisma.contact.create({
          data: {
            Campaign: c.Campaign || "",
            Range: c.Range || "",
            ContactNo: c.ContactNo || "",
            Location: c.Location || "",
            ContactType: c.ContactType || "",
            Name: c.Name || "",
            City: c.City || "",
            Address: c.Address || "",
            ContactIndustry: c.ContactIndustry || "",
            ContactFunctionalArea: c.ContactFunctionalArea || "",
            ReferenceId: c.ReferenceId || "",
            Notes: c.Notes || "",
            Facilities: c.Facilities || "",
            date: c.date || "",
            Email: c.Email || "",
            CompanyName: c.CompanyName || "",
            Website: c.Website || "",
            Status: c.Status || "",
            Qualifications: c.Qualifications || "",
            isFavourite: c.isFavourite || false,
            isImported: true,
          },
        });

        // For frontend compatibility shape: include _id and CreatedBy
        inserted.push({
          ...c,
          _id: created.id,
          id: created.id,
          CreatedBy: c.CreatedBy, // admin.id (not stored in DB)
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        });
      } catch (err) {
        // If a single insert fails, push to duplicateContacts as "failed" (you can change behavior if desired)
        duplicateContacts.push({ ...c, error: err.message });
      }
    }

    // ------------------------------
    // Create Summary File (same structure)
    // ------------------------------
    const summaryDir = path.join(__dirname, "../uploads/summaries");
    if (!fs.existsSync(summaryDir))
      fs.mkdirSync(summaryDir, { recursive: true });

    const summaryFile = path.join(
      summaryDir,
      `contact-import-summary-${Date.now()}.xlsx`
    );

    const summaryWorkbook = xlsx.utils.book_new();

    if (inserted.length)
      xlsx.utils.book_append_sheet(
        summaryWorkbook,
        xlsx.utils.json_to_sheet(inserted),
        "Imported_Contacts"
      );

    if (duplicateContacts.length)
      xlsx.utils.book_append_sheet(
        summaryWorkbook,
        xlsx.utils.json_to_sheet(duplicateContacts),
        "Duplicate_Contacts"
      );

    xlsx.writeFile(summaryWorkbook, summaryFile);

    // cleanup temp upload
    fs.unlink(req.file.path, () => {});

    // Final response (keeps same keys as your Mongo controller)
    return res.status(200).json({
      success: true,
      message: `${inserted.length} contacts imported successfully. ${duplicateContacts.length} duplicates skipped.`,
      totalRecords: finalContacts.length,
      importedCount: inserted.length,
      skippedCount: duplicateContacts.length,
      summaryFile: `/uploads/summaries/${path.basename(summaryFile)}`,
      importedContacts: inserted,
    });
  } catch (error) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    next(new ApiError(500, error.message));
  }
};

// ------------------------------
// Read Headers (same behavior)
// ------------------------------
export const readContactHeaders = async (req, res, next) => {
  try {
    if (!req.file) return next(new ApiError(400, "No file uploaded"));

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    fs.unlink(req.file.path, () => {});

    const headers = data[0] || [];
    if (!headers.length)
      return next(new ApiError(400, "No headers found in file"));

    res.status(200).json({
      success: true,
      message: "Headers extracted successfully",
      headers,
    });
  } catch (error) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    next(new ApiError(500, error.message));
  }
};
