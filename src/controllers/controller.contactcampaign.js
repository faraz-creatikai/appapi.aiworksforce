import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

const toMongoFormat = (item) => ({
  _id: item.id,
  Name: item.Name,
  Status: item.Status,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const toMongoArray = (items) => items.map(toMongoFormat);

// ===============================
// GET ALL
// ===============================
export const getContactCampaign = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    let where = {};

    if (keyword) {
      where.Name = {
        contains: keyword,
        mode: "insensitive",
      };
    }

    const campaigns = await prisma.contactCampaign.findMany({
      where,
      orderBy: { Name: "asc" },
      take: limit ? Number(limit) : undefined,
    });

    res.status(200).json(toMongoArray(campaigns));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const getContactCampaignById = async (req, res, next) => {
  try {
    const item = await prisma.contactCampaign.findUnique({
      where: { id: req.params.id },
    });

    if (!item) return next(new ApiError(404, "Contact Campaign not found"));

    res.status(200).json(toMongoFormat(item));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const createContactCampaign = async (req, res, next) => {
  try {
    const { Name, Status } = req.body;

    const newItem = await prisma.contactCampaign.create({
      data: { Name, Status },
    });

    res.status(201).json(toMongoFormat(newItem));
  } catch (error) {
    // Unique Name error
    if (error.code === "P2002") {
      return next(new ApiError(400, "Name must be unique"));
    }
    next(new ApiError(400, error.message));
  }
};

export const updateContactCampaign = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Clone request body
    let updateData = { ...req.body };

    // ❌ Remove fields Prisma cannot update
    delete updateData.id;
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.updatedAt;
    delete updateData.CreatedBy; // if exists

    const updated = await prisma.contactCampaign.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json(toMongoFormat(updated));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Contact Campaign not found"));
    }
    next(new ApiError(400, error.message));
  }
};

export const deleteContactCampaign = async (req, res, next) => {
  try {
    await prisma.contactCampaign.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "Contact Campaign deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Contact Campaign not found"));
    }
    next(new ApiError(500, error.message));
  }
};
