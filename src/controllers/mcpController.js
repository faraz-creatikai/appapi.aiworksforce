import prisma from "../config/prismaClient.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import xlsx from "xlsx";
import ApiError from "../utils/ApiError.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const importCustomersJson = async (req, res, next) => {
  try {
    const rawCustomers = req.body.customers;
    if (!Array.isArray(rawCustomers) || rawCustomers.length === 0) {
      return next(new ApiError(400, "No customers array provided in payload"));
    }

    // You can pass a fallback admin ID or pull it from a secure header
    const adminId = "YOUR-FALLBACK-ADMIN-UUID"; 

    // We skip normalizeKeys and fieldMapping because Claude's JSON 
    // will already exactly match our expected schema keys.

    // ----------------------------
    // Process rows
    // ----------------------------
    const processed = rawCustomers.map((r) => {
      // Basic cleanup based on your original logic
      const ContactNumber = r.ContactNumber || "101010101010"; 
      let PriceNumber = 0;
      if (r.Price && r.Price !== "N/A") {
        const raw = r.Price.toString().toLowerCase();
        let multiplier = 1;
        if (raw.includes("thousand") || raw.includes("thousands") || raw.includes("हज़ार")) multiplier = 1000;
        else if (raw.includes("lakh") || raw.includes("लाख")) multiplier = 100000;
        else if (raw.includes("crore") || raw.includes("करोड़") || raw.includes("cr")) multiplier = 10000000;
        PriceNumber = Number(raw.replace(/[^0-9.]/g, "")) * multiplier;
      }

      return {
        ...r,
        customerName: r.customerName || "N/A",
        ContactNumber: ContactNumber,
        PriceNumber: PriceNumber,
        isImported: true,
        LeadTemperature: "cold"
      };
    });

    const valid = processed.filter((r) => r.customerName && r.ContactNumber);
    const invalidRows = processed.filter((r) => !r.customerName || !r.ContactNumber);

    if (!valid.length) {
      return next(new ApiError(400, `No valid data. ${invalidRows.length} invalid rows skipped.`));
    }

    // ----------------------------
    // Duplicate check by ContactNumber
    // ----------------------------
    const contactNumbers = valid.map((v) => v.ContactNumber);
    const existingByPhone = await prisma.customer.findMany({
      where: { ContactNumber: { in: contactNumbers } },
      select: { ContactNumber: true },
    });
    const existingPhones = new Set(existingByPhone.map((e) => e.ContactNumber).filter(Boolean));

    const imported = [];
    const duplicates = [];
    const failed = [];

    // ---------------------------------------------
    // CACHES to avoid repeated DB calls
    // ---------------------------------------------
    const campaignCache = new Map(); 
    const typeCache = new Map(); 
    const subTypeCache = new Map(); 
    const cityCache = new Map(); 
    const locationCache = new Map(); 
    const subLocationCache = new Map(); 
    const referenceIdCache = new Map();
    const leadTypeCache = new Map();

    // --- Helper Functions (Reused exactly from your code) ---
    const getOrCreateCampaign = async (name) => {
      name = name?.trim();
      if (!name) return null;
      if (campaignCache.has(name)) return campaignCache.get(name);
      const found = await prisma.campaign.findUnique({ where: { Name: name }, select: { id: true } });
      if (found) { campaignCache.set(name, found.id); return found.id; }
      const created = await prisma.campaign.create({ data: { Name: name } });
      campaignCache.set(name, created.id); return created.id;
    };

    const getOrCreateType = async (typeName, campaignName) => {
      typeName = typeName?.trim(); campaignName = campaignName?.trim();
      if (!typeName) return null;
      const key = `${campaignName}::${typeName}`;
      if (typeCache.has(key)) return typeCache.get(key);
      let campaignId = campaignName ? await getOrCreateCampaign(campaignName) : await getOrCreateCampaign("Default");
      const found = await prisma.type.findFirst({ where: { Name: typeName, campaignId }, select: { id: true } });
      if (found) { typeCache.set(key, found.id); return found.id; }
      const created = await prisma.type.create({ data: { Name: typeName, campaignId } });
      typeCache.set(key, created.id); return created.id;
    };

    const getOrCreateSubType = async (subTypeName, campaignName, typeName) => {
      subTypeName = subTypeName?.trim(); if (!subTypeName) return null;
      campaignName = campaignName?.trim(); typeName = typeName?.trim();
      const key = `${campaignName}::${typeName}::${subTypeName}`;
      if (subTypeCache.has(key)) return subTypeCache.get(key);
      const campaignId = campaignName ? await getOrCreateCampaign(campaignName) : await getOrCreateCampaign("Default");
      const typeId = await getOrCreateType(typeName || "Default", campaignName || "Default");
      const found = await prisma.subType.findFirst({ where: { Name: subTypeName, campaignId, customerTypeId: typeId }, select: { id: true } });
      if (found) { subTypeCache.set(key, found.id); return found.id; }
      const created = await prisma.subType.create({ data: { Name: subTypeName, campaignId, customerTypeId: typeId } });
      subTypeCache.set(key, created.id); return created.id;
    };

    const getOrCreateCity = async (name) => {
      name = name?.trim(); if (!name) return null;
      if (cityCache.has(name)) return cityCache.get(name);
      const found = await prisma.city.findFirst({ where: { Name: name }, select: { id: true } });
      if (found) { cityCache.set(name, found.id); return found.id; }
      const created = await prisma.city.create({ data: { Name: name, Status: "Active" } });
      cityCache.set(name, created.id); return created.id;
    };

    const getOrCreateLocation = async (locationName, cityName) => {
      locationName = locationName?.trim(); cityName = cityName?.trim();
      if (!locationName) return null;
      const key = `${cityName}::${locationName}`;
      if (locationCache.has(key)) return locationCache.get(key);
      const cityId = cityName ? await getOrCreateCity(cityName) : await getOrCreateCity("Default");
      const found = await prisma.location.findFirst({ where: { Name: locationName, cityId }, select: { id: true } });
      if (found) { locationCache.set(key, found.id); return found.id; }
      const created = await prisma.location.create({ data: { Name: locationName, cityId } });
      locationCache.set(key, created.id); return created.id;
    };

    const getOrCreateSubLocation = async (subLocationName, locationName, cityName) => {
      subLocationName = subLocationName?.trim(); locationName = locationName?.trim(); cityName = cityName?.trim();
      if (!subLocationName) return null;
      const key = `${cityName}::${locationName}::${subLocationName}`;
      if (subLocationCache.has(key)) return subLocationCache.get(key);
      const cityId = cityName ? await getOrCreateCity(cityName) : await getOrCreateCity("Default");
      const locationId = locationName ? await getOrCreateLocation(locationName, cityName) : await getOrCreateLocation("Default", cityName || "Default");
      const found = await prisma.subLocation.findFirst({ where: { Name: subLocationName, locationId }, select: { id: true } });
      if (found) { subLocationCache.set(key, found.id); return found.id; }
      const created = await prisma.subLocation.create({ data: { Name: subLocationName, locationId, cityId } });
      subLocationCache.set(key, created.id); return created.id;
    };

    const getOrCreateReferenceId = async (ref) => {
      ref = ref?.trim(); if (!ref) return null;
      if (referenceIdCache.has(ref)) return ref;
      const found = await prisma.reference.findFirst({ where: { Name: ref }, select: { id: true } });
      if (found) { referenceIdCache.set(ref, true); return ref; }
      await prisma.reference.create({ data: { Name: ref, Status: "Active" } });
      referenceIdCache.set(ref, true); return ref;
    };

    const getOrCreateLeadType = async (leadtypename) => {
      leadtypename = leadtypename?.trim(); if (!leadtypename) return null;
      if (leadTypeCache.has(leadtypename)) return leadtypename;
      const found = await prisma.leadType.findFirst({ where: { Name: leadtypename }, select: { id: true } });
      if (found) { leadTypeCache.set(leadtypename, true); return leadtypename; }
      await prisma.leadType.create({ data: { Name: leadtypename, Status: "Active" } });
      leadTypeCache.set(leadtypename, true); return leadtypename;
    };

    // --------------------------------------------------
    // Insert one by one
    // --------------------------------------------------
    for (const row of valid) {
      if (row.ContactNumber && existingPhones.has(row.ContactNumber)) {
        duplicates.push(row);
      }

      try {
        if (row.Campaign) await getOrCreateCampaign(row.Campaign);
        if (row.CustomerType) await getOrCreateType(row.CustomerType, row.Campaign || "Default");
        if (row.CustomerSubType) await getOrCreateSubType(row.CustomerSubType, row.Campaign || "Default", row.CustomerType || "Default");
        if (row.City) await getOrCreateCity(row.City);
        if (row.Location) await getOrCreateLocation(row.Location, row.City || "Default");
        if (row.SubLocation) await getOrCreateSubLocation(row.SubLocation, row.Location || "Default", row.City || "Default");
        if (row.ReferenceId) await getOrCreateReferenceId(row.ReferenceId);
        if (row.LeadType) await getOrCreateLeadType(row.LeadType);

        const created = await prisma.customer.create({
          data: {
            ...row,
            CreatedById: adminId,
            City: row.City || "",
            updatedAt: new Date(),
          },
        });

        imported.push({ ...row, id: created.id });
        if (row.ContactNumber) existingPhones.add(row.ContactNumber);
      } catch (err) {
        failed.push({ ...row, error: err.message });
      }
    }

    // --------------------------------------------------
    // Create Excel Summary (Just like original!)
    // --------------------------------------------------
    const summaryDir = path.join(__dirname, "../uploads/summaries");
    if (!fs.existsSync(summaryDir)) fs.mkdirSync(summaryDir, { recursive: true });

    const filePath = path.join(summaryDir, `summary-${Date.now()}.xlsx`);
    const wb = xlsx.utils.book_new();

    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(imported), "Imported");
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(duplicates), "Duplicates");
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(invalidRows), "Invalid");
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(failed), "Failed");
    xlsx.writeFile(wb, filePath);

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
    next(new ApiError(500, err.message));
  }
};


export const createCustomerJson = async (req, res, next) => {
  try {
    const body = req.body;

    // Price Conversion Logic (Exactly as you had it)
    let PriceNumber = 0;
    if (body.Price && body.Price !== "N/A") {
      const raw = body.Price.toString().toLowerCase();
      let multiplier = 1;
      if (raw.includes("thousand") || raw.includes("thousands") || raw.includes("हज़ार")) {
        multiplier = 1000;
      } else if (raw.includes("lakh") || raw.includes("लाख")) {
        multiplier = 100000;
      } else if (raw.includes("crore") || raw.includes("करोड़") || raw.includes("cr")) {
        multiplier = 10000000;
      }
      PriceNumber = Number(raw.replace(/[^0-9.]/g, "")) * multiplier;
    }

    // Fallbacks for Claude API
    const finalContact = (body.ContactNumber && body.ContactNumber.trim() !== "") 
      ? body.ContactNumber 
      : "101010101010";
      
    // Set an API fallback Admin ID (Replace this UUID with a real ID from your Admin table)
    const AI_SYSTEM_ADMIN_ID = "YOUR-FALLBACK-ADMIN-UUID";

    const newCustomer = await prisma.customer.create({
      data: {
        customerName: body.customerName || "N/A",
        ContactNumber: finalContact,
        Campaign: body.Campaign,
        
        // Optional Fields 
        City: body.City || "N/A",
        Location: body.Location || "N/A",
        Adderess: body.Adderess || "N/A",
        Email: body.Email || "N/A",
        CustomerType: body.CustomerType || "N/A",
        LeadType: body.LeadType || "N/A",
        Description: body.Description || "N/A",
        Price: body.Price || "N/A",
        
        PriceNumber: PriceNumber,
        LeadTemperature: "cold",
        isImported: true, 

        // Database Relations
/*         CreatedById: AI_SYSTEM_ADMIN_ID,
        AssignTo: {
          connect: [{ id: AI_SYSTEM_ADMIN_ID }] 
        }, */

        updatedAt: new Date() 
      },
    });

    res.status(201).json({ success: true, data: newCustomer });
  } catch (error) {
    console.error("Prisma Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

