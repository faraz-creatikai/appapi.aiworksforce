import { PrismaClient } from "@prisma/client";
import ApiError from "../utils/ApiError.js";

const prisma = new PrismaClient();

// ---------------------------------------------------
//  HELPER FUNCTION (Mongo-like transformation)
// ---------------------------------------------------
const transformContactType = (ct) => ({
  _id: ct.id,
  Name: ct.Name,
  Status: ct.Status,
  Campaign: ct.Campaign
    ? {
        _id: ct.Campaign.id,
        Name: ct.Campaign.Name,
        Status: ct.Campaign.Status,
      }
    : null,
  createdAt: ct.createdAt,
  updatedAt: ct.updatedAt,
});

// ---------------------------------------------------
//  GET ALL CONTACT TYPES (with optional keyword & limit)
// ---------------------------------------------------
export const getContactType = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    const where = keyword
      ? {
          Name: { contains: keyword.trim(), mode: "insensitive" },
        }
      : {};

    const contactTypes = await prisma.contactType.findMany({
      where,
      include: {
        Campaign: { select: { id: true, Name: true, Status: true } },
      },
      orderBy: { Name: "asc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(contactTypes.map(transformContactType));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  GET CONTACT TYPE BY ID
// ---------------------------------------------------
export const getContactTypeById = async (req, res, next) => {
  try {
    const ct = await prisma.contactType.findUnique({
      where: { id: req.params.id },
      include: { Campaign: { select: { id: true, Name: true, Status: true } } },
    });

    if (!ct) return next(new ApiError(404, "ContactType not found"));

    res.status(200).json(transformContactType(ct));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  GET CONTACT TYPES BY CAMPAIGN
// ---------------------------------------------------
export const getContactTypeByCampaign = async (req, res, next) => {
  try {
    const { campaignId } = req.params;

    const contactTypes = await prisma.contactType.findMany({
      where: { campaignId },
      include: { Campaign: { select: { id: true, Name: true, Status: true } } },
      orderBy: { createdAt: "desc" },
    });

    if (!contactTypes || contactTypes.length === 0) {
      return next(
        new ApiError(404, "No Contact Types found for this campaign")
      );
    }

    res.status(200).json({
      success: true,
      count: contactTypes.length,
      data: contactTypes.map(transformContactType),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  CREATE CONTACT TYPE
// ---------------------------------------------------
export const createContactType = async (req, res, next) => {
  try {
    const { Campaign, Name, Status } = req.body;

    if (!Campaign) return next(new ApiError(400, "Campaign ID is required"));
    if (!Name) return next(new ApiError(400, "Contact Type name is required"));

    const ct = await prisma.contactType.create({
      data: {
        Name,
        Status: Status || "Active",
        campaignId: Campaign,
      },
      include: {
        Campaign: { select: { id: true, Name: true, Status: true } },
      },
    });

    res.status(201).json(transformContactType(ct));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// ---------------------------------------------------
//  UPDATE CONTACT TYPE
// ---------------------------------------------------
export const updateContactType = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Clone body
    let data = { ...req.body };

    // ❌ Remove Mongo-like fields
    delete data._id;
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;

    // ❌ Remove nested relation field
    delete data.Campaign;

    // ✔️ Assign the real FK Prisma expects
    data.campaignId = req.body.Campaign;

    const updatedCT = await prisma.contactType.update({
      where: { id },
      data,
      include: {
        Campaign: {
          select: { id: true, Name: true, Status: true },
        },
      },
    });

    res.status(200).json(transformContactType(updatedCT));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "ContactType not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// ---------------------------------------------------
//  DELETE CONTACT TYPE BY ID
// ---------------------------------------------------
export const deleteContactType = async (req, res, next) => {
  try {
    await prisma.contactType.delete({ where: { id: req.params.id } });

    res.status(200).json({ message: "ContactType deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "ContactType not found"));
    }
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  DELETE ALL CONTACT TYPES
// ---------------------------------------------------
export const deleteAllContactTypes = async (req, res, next) => {
  try {
    const deleted = await prisma.contactType.deleteMany();

    if (deleted.count === 0)
      return next(new ApiError(404, "No Contact Types found to delete"));

    res.status(200).json({ message: "All Contact Types deleted successfully" });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};
