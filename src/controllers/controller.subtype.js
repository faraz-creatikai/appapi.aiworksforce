import { PrismaClient } from "@prisma/client";
import ApiError from "../utils/ApiError.js";

const prisma = new PrismaClient();

// ---------------------------------------------------
//  HELPER FUNCTION (TRANSFORM)
// ---------------------------------------------------
const transformSubType = (sub) => ({
  _id: sub.id,
  Name: sub.Name,
  Status: sub.Status,
  Campaign: sub.Campaign
    ? {
        _id: sub.Campaign.id,
        Name: sub.Campaign.Name,
      }
    : null,
  CustomerType: sub.CustomerType
    ? {
        _id: sub.CustomerType.id,
        Name: sub.CustomerType.Name,
      }
    : null,
  createdAt: sub.createdAt,
  updatedAt: sub.updatedAt,
});

// 🚀 Dedicated In-Memory Caches for Campaign Master Data
const subTypeCache = new Map();

// Cache TTL: 5 minutes
const CACHE_TTL_MS = 5 * 60 * 1000;

// ---------------------------------------------------
//  GET ALL SUB TYPES
// ---------------------------------------------------
export const getSubType = async (req, res, next) => {
  try {
    const { keyword, limit, campaignId, typeId } = req.query;
    const now = Date.now();

    // 1. Query-Aware Cache Key
/*     const cacheKey = JSON.stringify({ keyword, limit, campaignId, typeId });

    if (subTypeCache.has(cacheKey)) {
      const cached = subTypeCache.get(cacheKey);
      if (cached.expiry > now) return res.status(200).json(cached.data);
      subTypeCache.delete(cacheKey);
    } */

    // 2. Build Query
    let where = {};
    if (campaignId) where.campaignId = campaignId;
    if (typeId) where.customerTypeId = typeId;
    if (keyword) {
      where.Name = { contains: keyword.trim(), mode: "insensitive" };
    }

    const subtypes = await prisma.subType.findMany({
      where,
      include: {
        Campaign: { select: { id: true, Name: true } },
        CustomerType: { select: { id: true, Name: true } },
      },
      orderBy: { Name: "asc" },
      take: limit ? Number(limit) : undefined,
    });

    // 3. Concurrent Transformation
    const transformedSubTypes = await Promise.all(subtypes.map(transformSubType));

    // 4. Update Cache
/*     subTypeCache.set(cacheKey, { data: transformedSubTypes, expiry: now + CACHE_TTL_MS });
    if (subTypeCache.size > 100) subTypeCache.delete(subTypeCache.keys().next().value); */

    return res.status(200).json(transformedSubTypes);
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  GET SUB TYPE BY ID
// ---------------------------------------------------
export const getSubTypeById = async (req, res, next) => {
  try {
    const subtype = await prisma.subType.findUnique({
      where: { id: req.params.id },
      include: {
        Campaign: { select: { id: true, Name: true } },
        CustomerType: { select: { id: true, Name: true } },
      },
    });

    if (!subtype) {
      return next(new ApiError(404, "Customer Sub Type not found"));
    }

    res.status(200).json(transformSubType(subtype));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  CREATE SUB TYPE
// ---------------------------------------------------
export const createSubType = async (req, res, next) => {
  try {
    const { Campaign, CustomerType, Name, Status } = req.body;

    if (!Campaign) return next(new ApiError(400, "Campaign ID is required"));
    if (!CustomerType)
      return next(new ApiError(400, "Customer Type ID is required"));
    if (!Name) return next(new ApiError(400, "Sub Type name is required"));

    const subtype = await prisma.subType.create({
      data: {
        Name,
        Status: Status || "Active",
        campaignId: Campaign,
        customerTypeId: CustomerType,
      },
      include: {
        Campaign: { select: { id: true, Name: true } },
        CustomerType: { select: { id: true, Name: true } },
      },
    });

    res.status(201).json(transformSubType(subtype));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// ---------------------------------------------------
//  UPDATE SUB TYPE
// ---------------------------------------------------
export const updateSubType = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Clone body
    let updateData = { ...req.body };

    // 🚫 Remove fields Prisma should not update
    delete updateData.id;
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.updatedAt;

    // ❌ Remove invalid nested fields
    delete updateData.Campaign;
    delete updateData.CustomerType;

    // ✔️ Map IDs correctly
    if (req.body.Campaign) {
      updateData.campaignId = req.body.Campaign;
    }
    if (req.body.CustomerType) {
      updateData.customerTypeId = req.body.CustomerType;
    }

    const updated = await prisma.subType.update({
      where: { id },
      data: updateData,
      include: {
        Campaign: { select: { id: true, Name: true } },
        CustomerType: { select: { id: true, Name: true } },
      },
    });

    res.status(200).json(transformSubType(updated));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Customer Sub Type not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// ---------------------------------------------------
//  DELETE ALL SUB TYPES
// ---------------------------------------------------
/* export const deleteSubType = async (req, res, next) => {
  try {
    const deleted = await prisma.subType.deleteMany({});

    if (deleted.count === 0)
      return next(new ApiError(404, "No Customer Sub Types found to delete"));

    res
      .status(200)
      .json({ message: "All Customer Sub Types deleted successfully" });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
}; */

// ---------------------------------------------------
// DELETE ALL SUBTYPES (or selected subtypes)
// ---------------------------------------------------
export const deleteSubType = async (req, res, next) => {
  try {

    const { subTypeIds } = req.body;

    // Normalize IDs (string → array)
    let ids = subTypeIds;
    if (typeof ids === "string") {
      try {
        ids = JSON.parse(ids);
      } catch {
        ids = [];
      }
    }
    if (!Array.isArray(ids)) ids = [];

    let subTypesToDelete = [];

    // ======================================================
    // 1️⃣ Fetch subtypes (selected or all)
    // ======================================================
    if (ids.length > 0) {
      subTypesToDelete = await prisma.subType.findMany({
        where: { id: { in: ids } },
      });

      if (subTypesToDelete.length === 0) {
        return next(new ApiError(404, "No valid subtypes found"));
      }
    } else {
      subTypesToDelete = await prisma.subType.findMany();

      if (subTypesToDelete.length === 0) {
        return next(new ApiError(404, "No subtypes found to delete"));
      }
    }

    const subTypeIdsToDelete = subTypesToDelete.map((s) => s.id);

    // ======================================================
    // 2️⃣ Delete SubTypes
    // ======================================================
    await prisma.subType.deleteMany({
      where: { id: { in: subTypeIdsToDelete } },
    });

    res.status(200).json({
      success: true,
      message:
        ids.length > 0
          ? "Selected subtypes deleted successfully"
          : "All subtypes deleted successfully",
      deletedSubTypeIds: subTypeIdsToDelete,
    });
  } catch (error) {
    console.error("❌ DeleteAllSubTypes Error:", error);
    next(new ApiError(500, error.message));
  }
};


// ---------------------------------------------------
//  DELETE SUB TYPE BY ID
// ---------------------------------------------------
export const deleteSubTypebyId = async (req, res, next) => {
  try {
    await prisma.subType.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "Customer Sub Type deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Customer Sub Type not found"));
    }
    next(new ApiError(500, error.message));
  }
};
