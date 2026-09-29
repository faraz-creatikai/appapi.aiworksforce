import { PrismaClient } from "@prisma/client";
import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// ----------------------------------------------
// TRANSFORM CONTACT FOLLOWUP → MONGODB FORMAT
// ----------------------------------------------
const transformConFollowup = (followup) => ({
  _id: followup.id,

  contact: followup.contact
    ? {
        _id: followup.contact.id,
        Campaign: followup.contact.Campaign || "",
        Range: followup.contact.Range || "",
        ContactNo: followup.contact.ContactNo || "",
        Location: followup.contact.Location || "",
        ContactType: followup.contact.ContactType || "",
        Name: followup.contact.Name || "",
        City: followup.contact.City || "",
        Address: followup.contact.Address || "",
        ContactIndustry: followup.contact.ContactIndustry || "",
        ContactFunctionalArea: followup.contact.ContactFunctionalArea || "",
        ReferenceId: followup.contact.ReferenceId || "",
        Notes: followup.contact.Notes || "",
        Facilities: followup.contact.Facilities || "",
        date: followup.contact.date || "",
        Email: followup.contact.Email || "",
        CompanyName: followup.contact.CompanyName || "",
        Website: followup.contact.Website || "",
        Status: followup.contact.Status || "",
        Qualifications: followup.contact.Qualifications || "",
        isFavourite: followup.contact.isFavourite || false,
        isImported: followup.contact.isImported || false,

        AssignTo: followup.contact.AssignTo
          ? {
              _id: followup.contact.AssignTo.id,
              name: followup.contact.AssignTo.name,
              email: followup.contact.AssignTo.email,
              role: followup.contact.AssignTo.role,
              city: followup.contact.AssignTo.city,
              phone: followup.contact.AssignTo.phone,
              status: followup.contact.AssignTo.status,
            }
          : null,

        createdAt: followup.contact.createdAt,
        updatedAt: followup.contact.updatedAt,
      }
    : null,

  StartDate: followup.StartDate || "",
  StatusType: followup.StatusType || "",
  FollowupNextDate: followup.FollowupNextDate || "",
  Description: followup.Description || "",
  createdAt: followup.createdAt,
  updatedAt: followup.updatedAt,

  // Flattened Mongo-like fields for filtering
  Campaign: followup.contact?.Campaign || "",
  Location: followup.contact?.Location || "",
  City: followup.contact?.City || "",
  ContactType: followup.contact?.ContactType || "",
  AssignTo: followup.contact?.AssignTo
    ? {
        _id: followup.contact.AssignTo.id,
        name: followup.contact.AssignTo.name,
      }
    : null,
});

const transformConFollowupById = (f) => ({
  _id: f.id,
  contact: f.contactId, // <- return only ID
  StartDate: f.StartDate,
  StatusType: f.StatusType,
  FollowupNextDate: f.FollowupNextDate,
  Description: f.Description,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
  __v: 0,
});

export const createConFollowup = async (req, res, next) => {
  try {
    const { contactId } = req.params;
    const { StartDate, StatusType, FollowupNextDate, Description } = req.body;

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) return next(new ApiError(404, "Contact not found"));

    const followup = await prisma.contactFollowup.create({
      data: {
        contactId,
        StartDate,
        StatusType,
        FollowupNextDate,
        Description,
      },
      include: { contact: { include: { AssignTo: true } } },
    });

    res.status(201).json({
      success: true,
      message: "Follow-up created successfully",
      data: transformConFollowup(followup),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const getConFollowups = async (req, res, next) => {
  try {
    const admin = req.admin;
    const {
      page = 1,
      limit = 10,
      keyword = "",
      StatusType,
      Campaign,
      PropertyType,
      City,
      Location,
      User,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const perPage = Math.max(1, parseInt(limit));
    const skip = (pageNum - 1) * perPage;

    // FOLLOWUP FILTER
    const whereFollowup = {};
    if (StatusType) whereFollowup.StatusType = StatusType.trim();

    // CONTACT FILTER
    const contactFilter = {};

    if (Campaign) contactFilter.Campaign = { contains: Campaign.trim() };
    if (PropertyType)
      contactFilter.ContactType = { contains: PropertyType.trim() };
    if (City) contactFilter.City = { contains: City.trim() };
    if (Location) contactFilter.Location = { contains: Location.trim() };

    if (User) {
      contactFilter.AssignTo = {
        name: { contains: User.trim() },
      };
    }

    if (admin.role === "user") {
      contactFilter.AssignTo = { id: admin.id }; // <── FIX
    }


    if (keyword) {
      const kw = keyword.trim();
      contactFilter.OR = [
        { Name: { contains: kw } },
        { Email: { contains: kw } },
        { CompanyName: { contains: kw } },
        { City: { contains: kw } },
        { Location: { contains: kw } },
      ];
    }

    const [total, followups] = await Promise.all([
      prisma.contactFollowup.count({
        where: {
          ...whereFollowup,
          contact: Object.keys(contactFilter).length
            ? contactFilter
            : undefined,
        },
      }),

      prisma.contactFollowup.findMany({
        where: {
          ...whereFollowup,
          contact: Object.keys(contactFilter).length
            ? contactFilter
            : undefined,
        },
        include: { contact: { include: { AssignTo: true } } },
        skip,
        take: perPage,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    res.status(200).json({
      success: true,
      total,
      currentPage: pageNum,
      totalPages: Math.ceil(total / perPage),
      data: followups.map(transformConFollowup),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const getConFollowupByContact = async (req, res, next) => {
  try {
    const { contactId } = req.params;

    const followups = await prisma.contactFollowup.findMany({
      where: { contactId },
      include: { contact: true },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      success: true,
      total: followups.length,
      data: followups.map((f) => ({
        _id: f.id,
        contact: f.contact.id,
        StartDate: f.StartDate,
        StatusType: f.StatusType,
        FollowupNextDate: f.FollowupNextDate,
        Description: f.Description,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        __v: 0,
      })),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const getConFollowupById = async (req, res, next) => {
  try {
    const followup = await prisma.contactFollowup.findUnique({
      where: { id: req.params.id },
    });

    if (!followup) return next(new ApiError(404, "Follow-up not found"));

    res.status(200).json({
      success: true,
      data: transformConFollowupById(followup),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const updateConFollowup = async (req, res, next) => {
  try {
    const { contact, ...rest } = req.body;

    const data = { ...rest };

    // If contact id is passed, convert it to prisma relation
    if (contact) {
      data.contact = {
        connect: { id: contact },
      };
    }

    const updated = await prisma.contactFollowup.update({
      where: { id: req.params.id },
      data,
      include: { contact: { include: { AssignTo: true } } },
    });

    res.status(200).json({
      success: true,
      message: "Follow-up updated successfully",
      data: transformConFollowup(updated),
    });
  } catch (error) {
    if (error.code === "P2025")
      return next(new ApiError(404, "Follow-up not found"));
    next(new ApiError(500, error.message));
  }
};

export const deleteConFollowup = async (req, res, next) => {
  try {
    await prisma.contactFollowup.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({
      success: true,
      message: "Follow-up deleted successfully",
    });
  } catch (error) {
    if (error.code === "P2025")
      return next(new ApiError(404, "Follow-up not found"));
    next(new ApiError(500, error.message));
  }
};

export const deleteConFollowupsByContact = async (req, res, next) => {
  try {
    const { contactId } = req.params;

    const result = await prisma.contactFollowup.deleteMany({
      where: { contactId },
    });

    res.status(200).json({
      success: true,
      message: "All followups for this contact deleted successfully",
      deletedCount: result.count,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};
