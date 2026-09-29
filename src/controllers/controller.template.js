import cloudinary from "../config/cloudinary.js";
import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";
import fs from "fs";

export const transformTemplate = (tpl) => ({
  _id: tpl.id,
  name: tpl.name,
  type: tpl.type,
  subject: tpl.subject,
  body: tpl.body,
  whatsappImage: tpl.whatsappImage,
  description: tpl.description,
  createdBy: tpl.createdBy,
  status: tpl.status,
  createdAt: tpl.createdAt,
  updatedAt: tpl.updatedAt,

  whatsappMediaType: tpl.whatsappMediaType,
  whatsappFileName: tpl.whatsappFileName,
  whatsappLinkPreview: tpl.whatsappLinkPreview,
  whatsappLocation: tpl.whatsappLocation,
  whatsappPoll: tpl.whatsappPoll,
  variables: tpl.variables,
  category: tpl.category,
});

const safeJsonParse = (val, fallback) => {
  if (val === undefined || val === null || val === "") return fallback;
  if (typeof val !== "string") return val; // already an object/array
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
};

export const createTemplate = async (req, res, next) => {
  try {
    const {
      name,
      type,
      subject = "",
      body,
      description = "",
      status = "Active",
    } = req.body;

    let whatsappImage = [];

    if (!name || !type || !body) {
      return next(new ApiError(400, "name, type and body are required"));
    }

    const existing = await prisma.template.findUnique({
      where: { name },
    });

    if (existing) {
      return next(new ApiError(409, "Template with this name already exists"));
    }
    if (req.files?.whatsappImage) {
      const mediaType = req.body.whatsappMediaType || "image";

      const uploadOptions = { folder: "templates/whatsapp_images" };

      if (mediaType === "video") {
        uploadOptions.resource_type = "video";
      } else if (mediaType === "document") {
        uploadOptions.resource_type = "raw"; // 👈 fixes the "Unsupported ZIP file" error
      } else {
        uploadOptions.resource_type = "image";
        uploadOptions.transformation = [{ width: 1000, crop: "limit" }]; // only valid for images
      }

      const uploads = req.files.whatsappImage.map((file) =>
        cloudinary.uploader.upload(file.path, uploadOptions).then((upload) => {
          fs.unlinkSync(file.path);
          return upload.secure_url;
        })
      );
      whatsappImage = await Promise.all(uploads);
    }

    let newTemplate = "";
    const whatsappLinkPreview = safeJsonParse(req.body.whatsappLinkPreview, null);
    const whatsappPoll = safeJsonParse(req.body.whatsappPoll, null);
    const variables = safeJsonParse(req.body.variables, []);
    const whatsappLocation = safeJsonParse(req.body.whatsappLocation, null);
    if (whatsappLocation) {
      const { lat, lng } = whatsappLocation;
      const valid =
        typeof lat === "number" && typeof lng === "number" &&
        !Number.isNaN(lat) && !Number.isNaN(lng) &&
        lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
      if (!valid) {
        return next(new ApiError(400, "whatsappLocation requires a valid lat/lng — pick a location on the map"));
      }
    }
    if (whatsappImage) {
      newTemplate = await prisma.template.create({
        data: {
          name,
          type,
          subject,
          body,
          whatsappImage: whatsappImage,
          description,
          status,
          createdBy: req.user?.id || "system",
          whatsappMediaType: req.body.whatsappMediaType || "image",
          whatsappFileName: req.body.whatsappFileName || "",
          whatsappLinkPreview,
          whatsappLocation,
          whatsappPoll,
          variables,
          category: req.body.category || "",
        },
      });
    }
    else {
      newTemplate = await prisma.template.create({
        data: {
          name,
          type,
          subject,
          body,
          description,
          status,
          createdBy: req.user?.id || "system",
          whatsappMediaType: req.body.whatsappMediaType || "image",
          whatsappFileName: req.body.whatsappFileName || "",
          whatsappLinkPreview,
          whatsappLocation,
          whatsappPoll,
          variables,
          category: req.body.category || "",
        },
      });
    }



    res.status(201).json({
      success: true,
      data: transformTemplate(newTemplate),
    });
  } catch (err) {
    next(new ApiError(500, err.message));
  }
};

export const getTemplates = async (req, res, next) => {
  try {
    // -------------------------
    // Pagination Fixes
    // -------------------------
    let page = parseInt(req.query.page);
    let limit = parseInt(req.query.limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 10;

    const skip = (page - 1) * limit;

    // -------------------------
    // Filters
    // -------------------------
    const { type, search = "" } = req.query;

    let filters = [];

    if (type) {
      filters.push({ type });
    }

    if (search.trim() !== "") {
      filters.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { body: { contains: search, mode: "insensitive" } },
          { subject: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    // Build final "where"
    const where = filters.length > 0 ? { AND: filters } : {}; // If no filters, avoid empty AND (Prisma error)

    // -------------------------
    // Query + Count
    // -------------------------
    const [data, total] = await Promise.all([
      prisma.template.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip,
        take: limit, // always a valid number now
      }),
      prisma.template.count({ where }),
    ]);

    // -------------------------
    // Response
    // -------------------------
    res.status(200).json({
      success: true,
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      data: data.map(transformTemplate),
    });
  } catch (err) {
    next(new ApiError(500, err.message));
  }
};

export const getTemplateById = async (req, res, next) => {
  try {
    const tpl = await prisma.template.findUnique({
      where: { id: req.params.id },
    });

    if (!tpl) return next(new ApiError(404, "Template not found"));

    res.status(200).json({ success: true, data: transformTemplate(tpl) });
  } catch (err) {
    next(new ApiError(500, err.message));
  }
};

export const updateTemplate = async (req, res, next) => {
  try {
    let clean = { ...req.body };

    // FORBIDDEN FIELDS
    delete clean._id;
    delete clean.id;
    delete clean.createdAt;
    delete clean.updatedAt;

    // ============================
    //  BOOLEAN PARSER FOR removeImage
    // ============================
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

    clean.removeImage = toBoolean(clean.removeImage);

    // ============================
    //  FETCH EXISTING TEMPLATE
    // ============================
    const existing = await prisma.template.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      return next(new ApiError(404, "Template not found"));
    }

    // Convert to array if stored as JSON/string
    let existingImages = [];
    try {
      existingImages = JSON.parse(existing.whatsappImage || "[]");
    } catch {
      existingImages = Array.isArray(existing.whatsappImage)
        ? existing.whatsappImage
        : [];
    }

    // Function to extract Cloudinary publicId
    const getPublicId = (url) => {
      if (!url) return null;
      const parts = url.split("/");
      const last = parts[parts.length - 1];
      return last.split(".")[0]; // remove extension
    };

    // ======================================================
    //        REMOVE EXISTING IMAGE IF removeImage = true
    // ======================================================
    if (clean.removeImage === true) {
      if (existingImages.length > 0) {
        const publicId = getPublicId(existingImages[0]);
        const existingMediaType = existing.whatsappMediaType || "image";

        if (publicId) {
          const destroyResourceType =
            existingMediaType === "video" ? "video" : existingMediaType === "document" ? "raw" : "image";

          await cloudinary.uploader.destroy(`templates/whatsapp_images/${publicId}`, {
            resource_type: destroyResourceType, // 👈 added
          });
        }
      }
      clean.whatsappImage = [];
    }

    // ======================================================
    //        UPLOAD NEW WHATSAPP IMAGE (ONLY ONE)
    // ======================================================
    if (req.files?.whatsappImage) {
      const file = req.files.whatsappImage[0];
      const mediaType = clean.whatsappMediaType || existing.whatsappMediaType || "image";

      if (clean.removeImage === true) {
        return next(
          new ApiError(400, "Cannot upload a new WhatsApp image while removeImage=true")
        );
      }

      const uploadOptions = { folder: "templates/whatsapp_images" };
      if (mediaType === "video") {
        uploadOptions.resource_type = "video";
      } else if (mediaType === "document") {
        uploadOptions.resource_type = "raw";
      } else {
        uploadOptions.resource_type = "image";
        uploadOptions.transformation = [{ width: 1000, crop: "limit" }];
      }

      const upload = await cloudinary.uploader.upload(file.path, uploadOptions);
      fs.unlinkSync(file.path);

      clean.whatsappImage = [upload.secure_url];
    }

    // remove removeImage from final DB update
    delete clean.removeImage;

    if (clean.whatsappLinkPreview !== undefined)
      clean.whatsappLinkPreview = safeJsonParse(clean.whatsappLinkPreview, null);
    if (clean.whatsappLocation !== undefined) {
      const parsedLocation = safeJsonParse(clean.whatsappLocation, null);

      if (parsedLocation) {
        const { lat, lng } = parsedLocation;
        const valid =
          typeof lat === "number" && typeof lng === "number" &&
          !Number.isNaN(lat) && !Number.isNaN(lng) &&
          lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

        if (!valid) {
          return next(
            new ApiError(400, "whatsappLocation requires a valid lat/lng — pick a location on the map")
          );
        }
      }

      clean.whatsappLocation = parsedLocation; // 👈 write the parsed object back, not the raw string
    }
    if (clean.whatsappPoll !== undefined)
      clean.whatsappPoll = safeJsonParse(clean.whatsappPoll, null);
    if (clean.variables !== undefined)
      clean.variables = safeJsonParse(clean.variables, []);

    // ======================================================
    // UPDATE TEMPLATE
    // ======================================================
    const updated = await prisma.template.update({
      where: { id: req.params.id },
      data: clean,
    });

    res.status(200).json({
      success: true,
      data: transformTemplate(updated),
    });
  } catch (err) {
    if (err.code === "P2025") {
      return next(new ApiError(404, "Template not found"));
    }
    next(new ApiError(500, err.message));
  }
};


export const deleteTemplate = async (req, res, next) => {
  try {
    await prisma.template.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ success: true, message: "Template deleted" });
  } catch (err) {
    if (err.code === "P2025") {
      return next(new ApiError(404, "Template not found"));
    }
    next(new ApiError(500, err.message));
  }
};
