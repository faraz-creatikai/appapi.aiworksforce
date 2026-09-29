import { PrismaClient } from "@prisma/client";
import ApiError from "../utils/ApiError.js";

const prisma = new PrismaClient();

// Mongo-like transformer
const transformSubLocation = (loc) => ({
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
    Location: loc.Location
        ? {
            _id: loc.Location.id,
            Name: loc.Location.Name,
            Status: loc.Location.Status,
        }
        : null,
    createdAt: loc.createdAt,
    updatedAt: loc.updatedAt,
});

// 🚀 Dedicated In-Memory Caches for Master Data
const subLocationCache = new Map();

// Master data rarely changes, so we can cache it for 5 minutes safely
const CACHE_TTL_MS = 5 * 60 * 1000;

// ---------------------------------------------------
// GET ALL LOCATIONS
// ---------------------------------------------------
export const getSubLocation = async (req, res, next) => {
    try {
        const { keyword, limit, city, location } = req.query;

        let where = {};

        if (keyword) {
            where.Name = { contains: keyword.trim(), mode: "insensitive" };
        }

        if (city) {
            where.cityId = city;
        }
        if (location) {
            where.id = location;
        }



        const locations = await prisma.subLocation.findMany({
            where,
            include: {
                City: { select: { id: true, Name: true, Status: true } },
                Location: { select: { id: true, Name: true, Status: true } },

            },
            orderBy: { Name: "asc" },
            take: limit ? Number(limit) : undefined,
        });

        res.status(200).json(locations.map(transformSubLocation));
    } catch (error) {
        next(new ApiError(500, error.message));
    }
};

// ---------------------------------------------------
// GET LOCATION BY ID
// ---------------------------------------------------
export const getSubLocationById = async (req, res, next) => {
    try {
        const loc = await prisma.subLocation.findUnique({
            where: { id: req.params.id },
            include: {
                City: { select: { id: true, Name: true, Status: true } },
                Location: { select: { id: true, Name: true, Status: true } },
            },
        });

        if (!loc) return next(new ApiError(404, " Sub Location not found"));

        res.status(200).json(transformSubLocation(loc));
    } catch (error) {
        next(new ApiError(500, error.message));
    }
};

// ---------------------------------------------------
// CREATE LOCATION
// ---------------------------------------------------
export const createSubLocation = async (req, res, next) => {
    try {
        const { Name, Status, City, Location } = req.body;

        if (!City) return next(new ApiError(400, "City ID is required"));
        if (!Location) return next(new ApiError(400, "Location ID is required"));

        const subloc = await prisma.subLocation.create({
            data: {
                Name,
                Status: Status || "Active",
                cityId: City,
                locationId: Location,
            },
            include: {
                City: { select: { id: true, Name: true, Status: true } },
                Location: { select: { id: true, Name: true, Status: true } },
            },
        });

        res.status(201).json(transformSubLocation(subloc));
    } catch (error) {
        next(new ApiError(400, error.message));
    }
};

// ---------------------------------------------------
// UPDATE LOCATION
// ---------------------------------------------------
export const updateSubLocation = async (req, res, next) => {
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
        delete updateData.Location;

        // ✔️ Map foreign key correctly
        if (req.body.City) {
            updateData.cityId = req.body.City;
        }
        if (req.body.Location) {
            updateData.locationId = req.body.Location;
        }

        const updatedSubLoc = await prisma.subLocation.update({
            where: { id },
            data: updateData,
            include: {
                City: { select: { id: true, Name: true, Status: true } },
                Location: { select: { id: true, Name: true, Status: true }, },
            },
        });

        res.status(200).json(transformSubLocation(updatedSubLoc));
    } catch (error) {
        if (error.code === "P2025") {
            return next(new ApiError(404, "SubLocation not found"));
        }
        next(new ApiError(400, error.message));
    }
};

// ---------------------------------------------------
// DELETE LOCATION
// ---------------------------------------------------
export const deleteSubLocation = async (req, res, next) => {
    try {
        await prisma.subLocation.delete({ where: { id: req.params.id } });

        res.status(200).json({ message: "SubLocation deleted successfully" });
    } catch (error) {
        if (error.code === "P2025") {
            return next(new ApiError(404, "SubLocation not found"));
        }
        next(new ApiError(500, error.message));
    }
};

// ---------------------------------------------------
// DELETE ALL SUBLOCATIONS (or selected sublocations)
// ---------------------------------------------------
export const deleteAllSubLocations = async (req, res, next) => {
  try {
    const { subLocationIds } = req.body;

    // Normalize IDs (string → array)
    let ids = subLocationIds;
    if (typeof ids === "string") {
      try {
        ids = JSON.parse(ids);
      } catch {
        ids = [];
      }
    }
    if (!Array.isArray(ids)) ids = [];

    let subLocationsToDelete = [];

    // ======================================================
    // 1️⃣ Fetch sublocations (selected or all)
    // ======================================================
    if (ids.length > 0) {
      subLocationsToDelete = await prisma.subLocation.findMany({
        where: { id: { in: ids } },
      });

      if (subLocationsToDelete.length === 0) {
        return next(new ApiError(404, "No valid sublocations found"));
      }
    } else {
      subLocationsToDelete = await prisma.subLocation.findMany();

      if (subLocationsToDelete.length === 0) {
        return next(new ApiError(404, "No sublocations found to delete"));
      }
    }

    const subLocationIdsToDelete = subLocationsToDelete.map((s) => s.id);

    // ======================================================
    // 2️⃣ Delete SubLocations
    // ======================================================
    await prisma.subLocation.deleteMany({
      where: { id: { in: subLocationIdsToDelete } },
    });

    res.status(200).json({
      success: true,
      message:
        ids.length > 0
          ? "Selected sublocations deleted successfully"
          : "All sublocations deleted successfully",
      deletedSubLocationIds: subLocationIdsToDelete,
    });
  } catch (error) {
    console.error("❌ DeleteAllSubLocations Error:", error);
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
// GET LOCATIONS BY CITY ID
// ---------------------------------------------------
export const getSubLocationByCityLocation = async (req, res, next) => {
    try {
        const { cityId, locationId } = req.params;
        const now = Date.now();

        // 1. Composite Cache Key
        /* const cacheKey = `${cityId}_${locationId}`;

        if (subLocationCache.has(cacheKey)) {
            const cached = subLocationCache.get(cacheKey);
            if (cached.expiry > now) return res.status(200).json(cached.data);
        } */

        // 2. Fetch Data
        const sublocations = await prisma.subLocation.findMany({
            where: { cityId, locationId },
            include: {
                City: { select: { id: true, Name: true, Status: true } },
                Location: { select: { id: true, Name: true, Status: true } },
            },
            orderBy: { Name: "asc" },
        });

        // 3. 🚀 FAIL-FAST: Skip Error stack trace generation
        if (sublocations.length === 0) {
            return res.status(404).json({ success: false, message: "No sublocations found for this city and location" });
        }

        // 4. Concurrent Transformation
        const transformedSubLocations = await Promise.all(sublocations.map(transformSubLocation));

        // 5. Structure payload
        const payload = {
            success: true,
            count: sublocations.length,
            data: transformedSubLocations,
        };

        // 6. Update Cache
        /* subLocationCache.set(cacheKey, { data: payload, expiry: now + CACHE_TTL_MS }); */

        return res.status(200).json(payload);
    } catch (error) {
        next(new ApiError(500, error.message));
    }
};
