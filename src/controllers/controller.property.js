import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";
import fs from "fs";
import cloudinary from "../config/cloudinary.js";
import { getKeywordSearchData } from "../ai/getKeywordSearchData.js";

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
const transformGetProperty = async (c) => {
  const base = {
    ...c,
    _id: c.id,
    PropertyImage: parseJSON(c.PropertyImage),
    AgentImage: parseJSON(c.AgentImage),
    CreatedBy: c.CreatedBy
      ? {
        id: c.CreatedBy.id,
        name: c.CreatedBy.name,
        email: c.CreatedBy.email,
        role: c.CreatedBy.role,
        city: c.CreatedBy.city,
      }
      : null,
  };


  return {
    ...base,
  };
};

// ------------------------------------------------------
//      Transform single property (getPropertyById)
// ------------------------------------------------------
const transformProperty = async (c) => {
  const base = {
    ...c,
    _id: c.id,
    PropertyImage: parseJSON(c.PropertyImage),
    AgentImage: parseJSON(c.AgentImage),
  };

  const [
    campaignDoc,
    typeDoc,
    subTypeDoc,
    cityDoc,
    locationDoc,
    subLocationDoc,
    createdByDoc,
  ] = await Promise.all([
    prisma.campaign.findFirst({
      where: { Name: c.Campaign },
      select: { id: true, Name: true },
    }),
    prisma.type.findFirst({
      where: { Name: c.PropertyType },
      select: { id: true, Name: true },
    }),
    prisma.subType.findFirst({
      where: { Name: c.PropertySubType },
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

    PropertyType: typeDoc
      ? { _id: typeDoc.id, Name: typeDoc.Name }
      : { _id: null, Name: c.PropertyType || "" },

    PropertySubType: subTypeDoc
      ? { _id: subTypeDoc.id, Name: subTypeDoc.Name }
      : { _id: null, Name: c.PropertySubType || "" },

    City: cityDoc
      ? { _id: cityDoc.id, Name: cityDoc.Name }
      : { _id: null, Name: c.City || "" },

    Location: locationDoc
      ? { _id: locationDoc.id, Name: locationDoc.Name }
      : { _id: null, Name: c.Location || "" },
    SubLocation: subLocationDoc
      ? { _id: subLocationDoc.id, Name: subLocationDoc.Name }
      : { _id: null, Name: c.SubLocation || "" },


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


// --------------------------------------------
// REMOVE DUPLICATES BY CONTACTNUMBER, KEEP LAST UPDATED
// --------------------------------------------
function deduplicateByContact(propertys) {
  const map = new Map();

  propertys.forEach((c) => {
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

// ------------------------------------------------------
//               GET CUSTOMERS
// ------------------------------------------------------
export const getProperty = async (req, res, next) => {
  try {
    const admin = req.admin;

    const {
      Campaign,
      PropertyType,
      PropertySubType,
      StatusType,
      City,
      Location,
      Keyword,
      SearchIn,
      ReferenceId,
      Price,
      StartDate,
      EndDate,
      Limit,
      Skip = 0,
      sort,
      User,
      ContactNumber
    } = req.query;

    let AND = [];
    const REQUIRED = Limit !== undefined ? Number(Limit) : 100;
    const FETCH_MULTIPLIER = 3; // safe over-fetch

    const offset = Number(Skip);

    // --------------------------------------------
    // ROLE-BASED FILTERS
    // --------------------------------------------
/* 
    if (admin.role !== "administrator" && admin.clientId) {
      AND.push({
        OR: [
          { ClientId: admin.clientId },
          { CreatedById: admin.id || admin._id }
        ]
      });
    }

    if (admin.role === "city_admin") {
      AND.push({ City: { contains: admin.city } });
    } else if (admin.role === "user") {
      AND.push({ AssignToId: admin.id || admin._id });
    } */


    // --------------------------------------------
    // BASIC FILTERS
    // --------------------------------------------
    if (Campaign) AND.push({ Campaign: { contains: Campaign.trim() } });

    if (PropertyType)
      AND.push({ PropertyType: { contains: PropertyType.trim() } });

    if (PropertySubType)
      AND.push({ PropertySubType: { contains: PropertySubType.trim() } });

    if (StatusType) AND.push({ Verified: { contains: StatusType.trim() } });

    if (City) AND.push({ City: { contains: City.trim() } });

    if (Location) AND.push({ Location: { contains: Location.trim() } });
    if (ContactNumber) AND.push({ ContactNumber: { contains: ContactNumber.trim() } });
    if (ReferenceId) AND.push({ ReferenceId: { contains: ReferenceId.trim() } });
    if (Price) AND.push({ Price: { contains: Price.trim() } });

    // --------------------------------------------
    // KEYWORD SEARCH
    // --------------------------------------------
    const keyword = Keyword?.trim();

    if (keyword) {
      const { tokens, fields } = await getKeywordSearchData(keyword);

      AND.push({
        AND: tokens.map((t) => ({
          OR: fields.map((field) => ({
            [field]: { contains: t },
          })),
        })),
      });
    }

    /*      if (keyword) {
       const tokens = keyword.split(" ").filter(Boolean);
 
       // Default fields (if user does NOT select anything)
       const defaultFields = [
         "Description",
         "Campaign",
         "PropertyType",
         "PropertySubType",
         "propertyName",
         "ContactNumber",
         "City",
         "Location",
         "SubLocation",
         "Price",
         "ReferenceId",
       ];
 
       // User-selected fields (comma-separated)
       // User-selected fields (array or single string)
       let selectedFields;
       if (!SearchIn) {
         selectedFields = defaultFields; // default fields if nothing selected
       } else if (Array.isArray(SearchIn)) {
         selectedFields = SearchIn.map(f => f.trim());
       } else {
         selectedFields = SearchIn.split(",").map(f => f.trim());
       }
 
       AND.push({
         AND: tokens.map((t) => ({
           OR: selectedFields.map((field) => ({
             [field]: { contains: t },
           })),
         })),
       });
     } */




    const where = AND.length ? { AND } : {};

    let orderBy = [];

    if (sort?.toLowerCase() === "asc") {
      orderBy.push({ createdAt: "asc" });
    }
    else {
      orderBy.push({ updatedAt: "desc" });
      orderBy.push({ createdAt: "desc" });
    }

    // --------------------------------------------
    // TOTAL COUNT (FOR PAGINATION)
    // --------------------------------------------
    const totalRecords = await prisma.property.count({ where });

    // --------------------------------------------
    // MAIN PRISMA FETCH
    // --------------------------------------------

    let propertys;

    if (Limit !== undefined) {
      // If Limit is provided → over-fetch to guarantee enough after JS filters
      const REQUIRED = Number(Limit);
      const FETCH_MULTIPLIER = 3;

      propertys = await prisma.property.findMany({
        where,
        orderBy,
        skip: offset,
        take: REQUIRED * FETCH_MULTIPLIER,
        include: {
          CreatedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              city: true,
            },
          },
        },
      });
    } else {
      // If Limit is NOT provided → behave as old flow (fetch all / default DB behavior)
      propertys = await prisma.property.findMany({
        where,
        orderBy,
        skip: offset,
        include: {
          CreatedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              city: true,
            },
          },
        },
      });
    }


    // --------------------------------------------
    // POST-FETCH FILTER BY PropertyDate (dd-mm-yyyy) ONLY IF BOTH START AND END PROVIDED
    // --------------------------------------------
    if (StartDate && EndDate) {
      const [sdDay, sdMonth, sdYear] = StartDate.split("-").map(Number);
      const [edDay, edMonth, edYear] = EndDate.split("-").map(Number);

      const start = new Date(sdYear, sdMonth - 1, sdDay, 0, 0, 0, 0);
      const end = new Date(edYear, edMonth - 1, edDay, 23, 59, 59, 999);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        propertys = propertys.filter((c) => {
          if (c.PropertyDate && c.PropertyDate.trim() !== "") {
            const parts = c.PropertyDate.split("-");
            let custDate;

            if (parts.length === 3) {
              // Check which format it is
              if (parts[0].length === 4) {
                // yyyy-mm-dd
                const [yyyy, mm, dd] = parts.map(Number);
                custDate = new Date(yyyy, mm - 1, dd);
              } else {
                // dd-mm-yyyy
                const [dd, mm, yyyy] = parts.map(Number);
                custDate = new Date(yyyy, mm - 1, dd);
              }
            } else {
              custDate = new Date(c.PropertyDate);
            }

            return !isNaN(custDate.getTime()) && custDate >= start && custDate <= end;
          }

          // If PropertyDate is empty, do NOT include
          return false;
        });
      }
    }





    // --------------------------------------------
    // FILTER BY USER (name / email / role / city)
    // --------------------------------------------
    if (User) {
      const userLower = User.toLowerCase();

      const admins = await prisma.admin.findMany({
        where: {
          OR: [
            { name: { contains: User } },
            { email: { contains: User } },
            { city: { contains: User } },

            // ENUM ROLE MATCH (no contains allowed)
            ["admin", "city_admin", "user"].includes(userLower)
              ? { role: { equals: User } }
              : undefined,
          ].filter(Boolean),
        },
        select: { id: true },
      });


      const transformed = await Promise.all(propertys.map(transformGetProperty));

      return res.status(200).json(transformed);
    }

    // --------------------------------------------
    // PRIORITY-BASED MATCHING & RANKING (AI-LIKE)
    // --------------------------------------------
    /* if (keyword) {
      const tokens = keyword.split(" ").filter(Boolean);

      propertys = propertys.map((c) => {
        let score = 0;

        const desc = c.Description?.toLowerCase() || "";
        const campaign = c.Campaign?.toLowerCase() || "";
        const type = c.PropertyType?.toLowerCase() || "";
        const subtype = c.PropertySubType?.toLowerCase() || "";
        const city = c.City?.toLowerCase() || "";
        const location = c.Location?.toLowerCase() || "";
        const sublocation = c.SubLocation?.toLowerCase() || "";
        const price = c.Price?.toString() || "";
        const ref = c.ReferenceId?.toLowerCase() || "";

        // 🔥 STRICT PRIORITY ORDER
        if (desc.includes(keyword)) score += 100;
        if (campaign.includes(keyword)) score += 90;
        if (type.includes(keyword)) score += 80;
        if (subtype.includes(keyword)) score += 70;
        if (city.includes(keyword)) score += 60;
        if (location.includes(keyword)) score += 50;
        if (sublocation.includes(keyword)) score += 40;
        if (price.includes(keyword)) score += 30;
        if (ref.includes(keyword)) score += 20;

        // 🔹 Multi-word partial matching (AI feel)
        tokens.forEach((t) => {
          if (desc.includes(t)) score += 10;
          if (campaign.includes(t)) score += 9;
          if (type.includes(t)) score += 8;
          if (subtype.includes(t)) score += 7;
          if (city.includes(t)) score += 6;
          if (location.includes(t)) score += 5;
          if (sublocation.includes(t)) score += 4;
          if (price.includes(t)) score += 3;
          if (ref.includes(t)) score += 2;
        });

        return { ...c, _score: score };
      });

      // Highest relevance first
      propertys.sort((a, b) => b._score - a._score);
    } */


    // --------------------------------------------
    // DEDUPLICATE BY CONTACTNUMBER ONLY IF NOT FILTERED BY ContactNumber
    // --------------------------------------------
    if (!ContactNumber) {
      propertys = deduplicateByContact(propertys);
    }

    if (Limit !== undefined) {
      propertys = propertys.slice(0, Number(Limit));
    }

    // --------------------------------------------
    // FINAL TRANSFORM
    // --------------------------------------------
    const transformed = await Promise.all(propertys.map(transformGetProperty));

    res.status(200).json(transformed);
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ------------------------------------------------------
//               GET SINGLE CUSTOMER
// ------------------------------------------------------
export const getPropertyById = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { id } = req.params;

    const property = await prisma.property.findUnique({ where: { id } });
    if (!property) return next(new ApiError(404, "Property not found"));

    const response = await transformProperty(property);
    res.status(200).json(response);
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// CREATE CUSTOMER
export const createProperty = async (req, res, next) => {
  try {
    const admin = req.admin;
    const body = req.body;

    let PropertyImage = [];
    let AgentImage = [];

    if (req.files?.PropertyImage) {
      const uploads = req.files.PropertyImage.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "property/property_images",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );
      PropertyImage = await Promise.all(uploads);
    }

    if (req.files?.AgentImage) {
      const uploads = req.files.AgentImage.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "property/site_plans",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );
      AgentImage = await Promise.all(uploads);
    }

    // --- Get active fields from master ---
    /*     const activeFields = await prisma.propertyFields.findMany({
          where: { Status: "Active" },
          select: { Name: true },
        });
        const allowedKeys = new Set(activeFields.map((f) => f.Name));
    
        const propertyFieldsRaw = body.PropertyFields ? JSON.parse(body.PropertyFields) : {};
        // --- Build PropertyFields JSON ---
        const propertyFieldsData = {};
        for (const key in propertyFieldsRaw) {
          if (allowedKeys.has(key)) {
            propertyFieldsData[key] = propertyFieldsRaw[key];
          }
        } */

    const parsedBody = {
      ...body,

      // convert float fields
      Price: body.Price ? parseFloat(body.Price) : undefined,

      // optional: convert other numeric fields if any
    };

    const newProperty = await prisma.property.create({
      data: {
        ...parsedBody,
        Email: body.Email || undefined,
         ClientId: admin.clientId,
        PropertyImage: JSON.stringify(PropertyImage),
        AgentImage: JSON.stringify(AgentImage),
        CreatedById: admin._id || admin.id,
      },
    });

    res
      .status(201)
      .json({ success: true, data: await transformProperty(newProperty) });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


export const updateProperty = async (req, res, next) => {
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

    // PARSE FIELDS FROM FRONTEND
    updateData.PropertyImage = safeParse(updateData.PropertyImage);
    updateData.AgentImage = safeParse(updateData.AgentImage);

    updateData.removedPropertyImages =
      safeParse(updateData.removedPropertyImages) || [];

    updateData.removedAgentImages = safeParse(updateData.removedAgentImages) || [];

    // FETCH CUSTOMER
    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return next(new ApiError(404, "Property not found"));

        if (admin.role !== "administrator" && admin.clientId) {
          if (existing.ClientId !== admin.clientId) {
            return next(
              new ApiError(403, "You cannot modify another company's customer")
            );
          }
        }

    // --- Get active fields from master ---
    /*    const activeFields = await prisma.propertyFields.findMany({
         where: { Status: "Active" },
         select: { Name: true },
       });
       const allowedKeys = new Set(activeFields.map((f) => f.Name));
   
       // --- Build PropertyFields JSON from request ---
       const propertyFieldsRaw = req.body.PropertyFields
         ? typeof req.body.PropertyFields === "string"
           ? JSON.parse(req.body.PropertyFields)
           : req.body.PropertyFields
         : {};
   
       // --- Merge with existing PropertyFields ---
       const existingPropertyFields = existing.PropertyFields || {};
       const mergedPropertyFields = {
         ...existingPropertyFields,
         ...Object.fromEntries(
           Object.entries(propertyFieldsRaw).filter(([key]) =>
             allowedKeys.has(key)
           )
         ),
       };
       updateData.PropertyFields = mergedPropertyFields; */



    // LOAD EXISTING IMAGES — FIXED
    let PropertyImage = safeParse(existing.PropertyImage) || [];
    let AgentImage = safeParse(existing.AgentImage) || [];

    if (typeof existing.PropertyImage === "string") {
      try {
        PropertyImage = JSON.parse(existing.PropertyImage);
      } catch {
        PropertyImage = [];
      }
    }
    if (typeof existing.AgentImage === "string") {
      try {
        AgentImage = JSON.parse(existing.AgentImage);
      } catch {
        AgentImage = [];
      }
    }

    // REMOVE SPECIFIC CUSTOMER IMAGES
    if (updateData.removedPropertyImages.length > 0) {
      await Promise.all(
        updateData.removedPropertyImages.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          if (publicId)
            return cloudinary.uploader.destroy(
              `property/property_images/${publicId}`
            );
        })
      );

      PropertyImage = PropertyImage.filter(
        (img) => !updateData.removedPropertyImages.includes(img)
      );
    }

    // REMOVE SPECIFIC SITE PLANS
    if (updateData.removedAgentImages.length > 0) {
      await Promise.all(
        updateData.removedAgentImages.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          if (publicId)
            return cloudinary.uploader.destroy(
              `property/site_plans/${publicId}`
            );
        })
      );

      AgentImage = AgentImage.filter(
        (img) => !updateData.removedAgentImages.includes(img)
      );
    }

    // REMOVE ALL CUSTOMER IMAGES
    if (
      updateData.PropertyImage !== undefined &&
      Array.isArray(updateData.PropertyImage) &&
      updateData.PropertyImage.length === 0
    ) {
      await Promise.all(
        PropertyImage.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          if (publicId)
            return cloudinary.uploader.destroy(
              `property/property_images/${publicId}`
            );
        })
      );
      PropertyImage = [];
    }

    // REMOVE ALL SITE PLANS
    if (
      updateData.AgentImage !== undefined &&
      Array.isArray(updateData.AgentImage) &&
      updateData.AgentImage.length === 0
    ) {
      await Promise.all(
        AgentImage.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          if (publicId)
            return cloudinary.uploader.destroy(
              `property/site_plans/${publicId}`
            );
        })
      );
      AgentImage = [];
    }

    // UPLOAD NEW CUSTOMER IMAGES
    if (req.files?.PropertyImage) {
      const uploads = req.files.PropertyImage.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "property/property_images",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );

      PropertyImage.push(...(await Promise.all(uploads)));
    }

    // UPLOAD NEW SITE PLANS
    if (req.files?.AgentImage) {
      const uploads = req.files.AgentImage.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "property/site_plans",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );

      AgentImage.push(...(await Promise.all(uploads)));
    }

    // SAVE FINAL IMAGE ARRAYS
    updateData.PropertyImage = JSON.stringify(PropertyImage);
    updateData.AgentImage = JSON.stringify(AgentImage);

    // Fix null relations

    if (updateData.CreatedById === "") updateData.CreatedById = null;

    // REMOVE NON-DB KEYS
    delete updateData.removedPropertyImages;
    delete updateData.removedAgentImages;
    delete updateData["removedPropertyImages "];
    delete updateData["removedAgentImages "];

    // ✅ BOOLEAN FIX — JUST THIS LINE
    updateData.isFavourite = toBoolean(updateData.isFavourite);
    updateData.isChecked = toBoolean(updateData.isChecked)

    const onlyIsChecked = Object.keys(req.body).length === 1 && 'isChecked' in req.body;

    if (!onlyIsChecked) {
      updateData.updatedAt = new Date(); // force updatedAt to change
    }

    const parsedBody = {
      ...updateData,

      // convert float fields
      Price: updateData.Price ? parseFloat(updateData.Price) : undefined,

      // optional: convert other numeric fields if any
    };

    // UPDATE CUSTOMER
    const updated = await prisma.property.update({
      where: { id },
      data: parsedBody,
    });

    res.status(200).json({
      success: true,
      message: "Property updated successfully",
      data: await transformProperty(updated),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// DELETE CUSTOMER
export const deleteProperty = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { id } = req.params;

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return next(new ApiError(404, "Property not found"));



    const PropertyImage = parseJSON(existing.PropertyImage);
    const AgentImage = parseJSON(existing.AgentImage);

    const deletions = [
      ...PropertyImage.map((url) =>
        cloudinary.uploader.destroy(
          `property/property_images/${getPublicIdFromUrl(url)}`
        )
      ),
      ...AgentImage.map((url) =>
        cloudinary.uploader.destroy(
          `property/site_plans/${getPublicIdFromUrl(url)}`
        )
      ),
    ];

    await Promise.allSettled(deletions);

    await prisma.property.delete({ where: { id } });

    res.status(200).json({ message: "Property deleted successfully" });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};



// GET FAVOURITES
export const getFavouritePropertys = async (req, res, next) => {
  try {
    const admin = req.admin;
    let where = { isFavourite: true };



    const favs = await prisma.property.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    const transformed = await Promise.all(favs.map(transformGetProperty));
    res
      .status(200)
      .json({ success: true, count: transformed.length, data: transformed });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ✅ DELETE SELECTED OR ALL CUSTOMERS (Prisma version, same logic as MongoDB)
export const deleteAllPropertys = async (req, res, next) => {
  try {
    const admin = req.admin;
    if (admin.role !== "administrator")
      return next(new ApiError(403, "Only administrator can delete propertys"));

    const { propertyIds } = req.body;

    // Normalize IDs (string → array)
    let ids = propertyIds;
    if (typeof ids === "string") {
      try {
        ids = JSON.parse(ids);
      } catch {
        ids = [];
      }
    }
    if (!Array.isArray(ids)) ids = [];

    let propertysToDelete = [];

    if (ids.length > 0) {
      propertysToDelete = await prisma.property.findMany({
        where: { id: { in: ids } },
      });
      if (propertysToDelete.length === 0)
        return next(new ApiError(404, "No valid propertys found"));
    } else {
      propertysToDelete = await prisma.property.findMany();
      if (propertysToDelete.length === 0)
        return next(new ApiError(404, "No propertys found to delete"));
    }

    const deletions = [];

    for (const c of propertysToDelete) {
      const PropertyImage = parseJSON(c.PropertyImage);
      const AgentImage = parseJSON(c.AgentImage);

      if (PropertyImage?.length) {
        deletions.push(
          ...PropertyImage.map((url) =>
            cloudinary.uploader.destroy(
              `property/property_images/${getPublicIdFromUrl(url)}`
            )
          )
        );
      }

      if (AgentImage?.length) {
        deletions.push(
          ...AgentImage.map((url) =>
            cloudinary.uploader.destroy(
              `property/site_plans/${getPublicIdFromUrl(url)}`
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
        where: { propertyId: { in: ids } },
      });
    } else {
      await prisma.followup.deleteMany({});
    }

    // Delete propertys
    if (ids.length > 0) {
      await prisma.property.deleteMany({ where: { id: { in: ids } } });
    } else {
      await prisma.property.deleteMany({});
    }

    res.status(200).json({
      success: true,
      message:
        ids.length > 0
          ? "Selected propertys deleted successfully"
          : "All propertys deleted successfully",
      deletedPropertyIds:
        ids.length > 0 ? ids : propertysToDelete.map((c) => c.id),
    });
  } catch (error) {
    console.error("❌ DeleteAllPropertys Error:", error);
    next(new ApiError(500, error.message));
  }
};