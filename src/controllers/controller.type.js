import { PrismaClient } from "@prisma/client";
import ApiError from "../utils/ApiError.js";

const prisma = new PrismaClient();

// ---------------------------------------------------
//  HELPER FUNCTION ( TRANSFORM RESPONSE )
// ---------------------------------------------------
const transformType = (type) => ({
  _id: type.id,
  Name: type.Name,
  Status: type.Status,
  Campaign: type.Campaign
    ? {
        _id: type.Campaign.id,
        Name: type.Campaign.Name,
      }
    : null,
  createdAt: type.createdAt,
  updatedAt: type.updatedAt,
});

const typeCache = new Map();

// Cache TTL: 5 minutes
const CACHE_TTL_MS = 5 * 60 * 1000;

// ---------------------------------------------------
//  GET ALL TYPES
// ---------------------------------------------------
export const getType = async (req, res, next) => {
  try {
    const { keyword, limit, campaignId } = req.query;
    const now = Date.now();

    // 1. Query-Aware Cache Key
/*     const cacheKey = JSON.stringify({ keyword, limit, campaignId });

    if (typeCache.has(cacheKey)) {
      const cached = typeCache.get(cacheKey);
      if (cached.expiry > now) return res.status(200).json(cached.data);
      typeCache.delete(cacheKey);
    } */

    // 2. Build Query
    let where = {};
    if (campaignId) where.campaignId = campaignId;
    if (keyword) {
      where.Name = { contains: keyword.trim(), mode: "insensitive" };
    }

    const types = await prisma.type.findMany({
      where,
      include: {
        Campaign: { select: { id: true, Name: true } },
      },
      orderBy: { Name: "asc" },
      take: limit ? Number(limit) : undefined,
    });

    // 3. Concurrent Transformation
    const transformedTypes = await Promise.all(types.map(transformType));

    // 4. Update Cache
/*     typeCache.set(cacheKey, { data: transformedTypes, expiry: now + CACHE_TTL_MS });
    if (typeCache.size > 100) typeCache.delete(typeCache.keys().next().value); */

    return res.status(200).json(transformedTypes);
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};
// ---------------------------------------------------
//  GET TYPE BY ID
// ---------------------------------------------------
export const getTypeById = async (req, res, next) => {
  try {
    const type = await prisma.type.findUnique({
      where: { id: req.params.id },
      include: {
        Campaign: {
          select: { id: true, Name: true },
        },
      },
    });

    if (!type) return next(new ApiError(404, "Type not found"));

    res.status(200).json(transformType(type));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  CREATE TYPE
// ---------------------------------------------------
export const createType = async (req, res, next) => {
  try {
    const { Campaign, Name, Status } = req.body;

    if (!Campaign) return next(new ApiError(400, "Campaign ID is required"));
    if (!Name) return next(new ApiError(400, "Type name is required"));

    const type = await prisma.type.create({
      data: {
        Name,
        Status: Status || "Active",
        campaignId: Campaign,
      },
      include: {
        Campaign: { select: { id: true, Name: true } },
      },
    });

    res.status(201).json(transformType(type));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// ---------------------------------------------------
//  UPDATE TYPE
// ---------------------------------------------------
export const updateType = async (req, res, next) => {
  try {
    const { id } = req.params;

    let updateData = { ...req.body };

    // Remove fields that Prisma cannot accept
    delete updateData.id;
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.updatedAt;

    // ❌ Remove invalid nested field
    delete updateData.Campaign;

    // ✔️ Correctly assign campaignId
    if (req.body.Campaign) {
      updateData.campaignId = req.body.Campaign;
    }

    const updatedType = await prisma.type.update({
      where: { id },
      data: updateData,
      include: {
        Campaign: { select: { id: true, Name: true } },
      },
    });

    res.status(200).json(transformType(updatedType));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Type not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// ---------------------------------------------------
//  DELETE ALL TYPES
// ---------------------------------------------------
/* export const deleteType = async (req, res, next) => {
  try {
    const deleted = await prisma.type.deleteMany({});

    if (deleted.count === 0)
      return next(new ApiError(404, "No Types found to delete"));

    res.status(200).json({ message: "All Types deleted successfully" });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
}; */

// ---------------------------------------------------
// DELETE ALL TYPES (or selected types) + SubTypes
// ---------------------------------------------------
export const deleteType = async (req, res, next) => {
  try {

    const { typeIds } = req.body;

    // Normalize IDs (string → array)
    let ids = typeIds;
    if (typeof ids === "string") {
      try {
        ids = JSON.parse(ids);
      } catch {
        ids = [];
      }
    }
    if (!Array.isArray(ids)) ids = [];

    let typesToDelete = [];

    // ======================================================
    // 1️⃣ Fetch types (selected or all)
    // ======================================================
    if (ids.length > 0) {
      typesToDelete = await prisma.type.findMany({
        where: { id: { in: ids } },
      });

      if (typesToDelete.length === 0) {
        return next(new ApiError(404, "No valid types found"));
      }
    } else {
      typesToDelete = await prisma.type.findMany();

      if (typesToDelete.length === 0) {
        return next(new ApiError(404, "No types found to delete"));
      }
    }

    const typeIdsToDelete = typesToDelete.map((t) => t.id);

    // ======================================================
    // 2️⃣ Delete all SubTypes linked to these Types
    // ======================================================
    await prisma.subType.deleteMany({
      where: { customerTypeId: { in: typeIdsToDelete } },
    });

    // ======================================================
    // 3️⃣ Delete Types
    // ======================================================
    await prisma.type.deleteMany({
      where: { id: { in: typeIdsToDelete } },
    });

    res.status(200).json({
      success: true,
      message:
        ids.length > 0
          ? "Selected types and subtypes deleted successfully"
          : "All types and subtypes deleted successfully",
      deletedTypeIds: typeIdsToDelete,
    });
  } catch (error) {
    console.error("❌ DeleteAllTypes Error:", error);
    next(new ApiError(500, error.message));
  }
};


// ---------------------------------------------------
//  DELETE TYPE BY ID
// ---------------------------------------------------
export const deleteTypebyId = async (req, res, next) => {
  try {
    const id = req.params.id;

    // 1️⃣ Delete all SubTypes linked with this Type
    await prisma.subType.deleteMany({
      where: { customerTypeId: id },
    });

    // 2️⃣ Delete the Type
    await prisma.type.delete({
      where: { id },
    });

    res.status(200).json({ message: "Type deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Type not found"));
    }
    next(new ApiError(500, error.message));
  }
};
