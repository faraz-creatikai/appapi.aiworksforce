import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

export const transformCity = (city) => ({
  _id: city.id, // mimic MongoDB's _id
  Name: city.Name,
  Status: city.Status,
  createdAt: city.createdAt,
  updatedAt: city.updatedAt,
});

// 🚀 Dedicated In-Memory Caches for Master Data
const cityCache = new Map();

// Master data rarely changes, so we can cache it for 5 minutes safely
const CACHE_TTL_MS = 5 * 60 * 1000;

// GET ALL CITIES
export const getCity = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;
    const now = Date.now();
    
    // 1. Query-Aware Cache Key
/*     const cacheKey = JSON.stringify({ keyword, limit });

    if (cityCache.has(cacheKey)) {
      const cached = cityCache.get(cacheKey);
      if (cached.expiry > now) {
        return res.status(200).json(cached.data);
      } else {
        cityCache.delete(cacheKey);
      }
    } */

    // 2. Build Query
    let where = {};
    if (keyword) {
      where.Name = { contains: keyword.trim(), mode: "insensitive" };
    }

    const cities = await prisma.city.findMany({
      where,
      orderBy: { Name: "asc" },
      take: limit ? Number(limit) : undefined,
    });

    // 3. Concurrent Transformation
    const transformedCities = await Promise.all(cities.map(transformCity));

    // 4. Update Cache & Basic Garbage Collection
   /*  cityCache.set(cacheKey, { data: transformedCities, expiry: now + CACHE_TTL_MS });
    if (cityCache.size > 100) cityCache.delete(cityCache.keys().next().value); */

    return res.status(200).json(transformedCities);
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// GET CITY BY ID
export const getCityById = async (req, res, next) => {
  try {
    const city = await prisma.city.findUnique({
      where: { id: req.params.id },
    });

    if (!city) return next(new ApiError(404, "City not found"));

    res.status(200).json(transformCity(city));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// CREATE CITY
export const createCity = async (req, res, next) => {
  try {
    const { Name, Status } = req.body;

    const newCity = await prisma.city.create({
      data: { Name, Status },
    });

    res.status(201).json(transformCity(newCity));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// UPDATE CITY
export const updateCity = async (req, res, next) => {
  try {
    const { id } = req.params;

    const updatedCity = await prisma.city.update({
      where: { id },
      data: req.body,
    });

    res.status(200).json(transformCity(updatedCity));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "City not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// DELETE CITY
export const deleteCity = async (req, res, next) => {
  try {
    const id = req.params.id;

    // Delete all SubLocations linked to this City
    await prisma.subLocation.deleteMany({
      where: { cityId: id },
    });
    
    // Delete all Locations linked to this City
    await prisma.location.deleteMany({
      where: { cityId: id },
    });

    //  Delete the City
    await prisma.city.delete({
      where: { id },
    });

    

    res.status(200).json({ message: "City deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "City not found"));
    }
    next(new ApiError(500, error.message));
  }
};
