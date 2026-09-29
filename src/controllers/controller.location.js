import { PrismaClient } from "@prisma/client";
import ApiError from "../utils/ApiError.js";

const prisma = new PrismaClient();

// Mongo-like transformer
const transformLocation = (loc) => ({
  _id: loc.id,
  Name: loc.Name,
  Status: loc.Status,
  City: loc.City
    ? {
      _id: loc.City.id,
      Name: loc.City.Name,
      Status: loc.City.Status,
    }
    : null,
  createdAt: loc.createdAt,
  updatedAt: loc.updatedAt,
});

const locationCache = new Map();

const CACHE_TTL_MS = 5 * 60 * 1000;

// ---------------------------------------------------
// GET ALL LOCATIONS
// ---------------------------------------------------
export const getLocation = async (req, res, next) => {
  try {
    const { keyword, limit, city } = req.query;

    let where = {};

    if (keyword) {
      where.Name = { contains: keyword.trim(), mode: "insensitive" };
    }

    if (city) {
      where.cityId = city;
    }

    const locations = await prisma.location.findMany({
      where,
      include: {
        City: { select: { id: true, Name: true, Status: true } },
      },
      orderBy: { Name: "asc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(locations.map(transformLocation));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
// GET LOCATION BY ID
// ---------------------------------------------------
export const getLocationById = async (req, res, next) => {
  try {
    const loc = await prisma.location.findUnique({
      where: { id: req.params.id },
      include: {
        City: { select: { id: true, Name: true, Status: true } },
      },
    });

    if (!loc) return next(new ApiError(404, "Location not found"));

    res.status(200).json(transformLocation(loc));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
// CREATE LOCATION
// ---------------------------------------------------
export const createLocation = async (req, res, next) => {
  try {
    const { Name, Status, City } = req.body;

    if (!City) return next(new ApiError(400, "City ID is required"));

    const loc = await prisma.location.create({
      data: {
        Name,
        Status: Status || "Active",
        cityId: City,
      },
      include: {
        City: { select: { id: true, Name: true, Status: true } },
      },
    });

    res.status(201).json(transformLocation(loc));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// ---------------------------------------------------
// UPDATE LOCATION
// ---------------------------------------------------
export const updateLocation = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Clone request body
    let updateData = { ...req.body };

    // 🚫 Remove fields Prisma should not update
    delete updateData.id;
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.updatedAt;

    // ❌ Remove invalid nested field
    delete updateData.City;

    // ✔️ Map foreign key correctly
    if (req.body.City) {
      updateData.cityId = req.body.City;
    }

    const updatedLoc = await prisma.location.update({
      where: { id },
      data: updateData,
      include: {
        City: { select: { id: true, Name: true, Status: true } },
      },
    });

    res.status(200).json(transformLocation(updatedLoc));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Location not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// ---------------------------------------------------
// DELETE LOCATION
// ---------------------------------------------------
export const deleteLocation = async (req, res, next) => {
  try {
    const id = req.params.id;

    // 1️⃣ Delete all SubLocations linked to this Location
    await prisma.subLocation.deleteMany({
      where: { locationId: id },
    });

    // 2️⃣ Delete the Location itself
    await prisma.location.delete({ where: { id } });

    res.status(200).json({ message: "Location deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Location not found"));
    }
    next(new ApiError(500, error.message));
  }
};


// ---------------------------------------------------
// DELETE ALL LOCATIONS (or selected locations)
// ---------------------------------------------------
export const deleteAllLocations = async (req, res, next) => {
  try {
    const { locationIds } = req.body;

    // Normalize IDs (string → array)
    let ids = locationIds;
    if (typeof ids === "string") {
      try {
        ids = JSON.parse(ids);
      } catch {
        ids = [];
      }
    }
    if (!Array.isArray(ids)) ids = [];

    let locationsToDelete = [];

    // ======================================================
    // 1️⃣ Fetch locations (selected or all)
    // ======================================================
    if (ids.length > 0) {
      locationsToDelete = await prisma.location.findMany({
        where: { id: { in: ids } },
      });

      if (locationsToDelete.length === 0) {
        return next(new ApiError(404, "No valid locations found"));
      }
    } else {
      locationsToDelete = await prisma.location.findMany();

      if (locationsToDelete.length === 0) {
        return next(new ApiError(404, "No locations found to delete"));
      }
    }

    const locationIdsToDelete = locationsToDelete.map((l) => l.id);

    // ======================================================
    // 2️⃣ Delete all related SubLocations
    // ======================================================
    await prisma.subLocation.deleteMany({
      where: { locationId: { in: locationIdsToDelete } },
    });

    // ======================================================
    // 3️⃣ Delete Locations
    // ======================================================
    await prisma.location.deleteMany({
      where: { id: { in: locationIdsToDelete } },
    });

    res.status(200).json({
      success: true,
      message:
        ids.length > 0
          ? "Selected locations deleted successfully"
          : "All locations deleted successfully",
      deletedLocationIds: locationIdsToDelete,
    });
  } catch (error) {
    console.error("❌ DeleteAllLocations Error:", error);
    next(new ApiError(500, error.message));
  }
};



// ---------------------------------------------------
// GET LOCATIONS BY CITY ID
// ---------------------------------------------------
export const getLocationByCity = async (req, res, next) => {
  try {
    const { cityId } = req.params;
    const now = Date.now();

    // 1. Serve from cache instantly
   /*  if (locationCache.has(cityId)) {
      const cached = locationCache.get(cityId);
      if (cached.expiry > now) return res.status(200).json(cached.data);
    } */

    // 2. Fetch Data
    const locations = await prisma.location.findMany({
      where: { cityId },
      include: {
        City: { select: { id: true, Name: true, Status: true } },
      },
      orderBy: { Name: "asc" },
    });

    // 3. 🚀 FAIL-FAST: Return a 404 response directly instead of throwing an expensive Error object
    if (locations.length === 0) {
      return res.status(404).json({ success: false, message: "No locations found for this city" });
    }

    // 4. Concurrent Transformation
    const transformedLocations = await Promise.all(locations.map(transformLocation));
    
    // 5. Structure payload (Exact same as your original)
    const payload = {
      success: true,
      count: locations.length,
      data: transformedLocations,
    };

    // 6. Update Cache
/*     locationCache.set(cityId, { data: payload, expiry: now + CACHE_TTL_MS }); */

    return res.status(200).json(payload);
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};
