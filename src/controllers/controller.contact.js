import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

const safeParse = (val) => {
  if (val === undefined || val === null || val === "") return undefined;
  try {
    return JSON.parse(val);
  } catch {
    return undefined;
  }
};

const toEmptyString = (val) => {
  if (!val || val === null || val === undefined) return "";
  return val;
};

const transformBasicContact = async (c) => {
  const base = {
    ...c,
    _id: c.id,
  };

  const assignToDoc = c.AssignToId
    ? await prisma.admin.findUnique({
        where: { id: c.AssignToId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          city: true,
        },
      })
    : null;

  return {
    ...base,
    AssignTo: assignToDoc
      ? {
          _id: assignToDoc.id,
          name: assignToDoc.name,
          email: assignToDoc.email,
          role: assignToDoc.role,
          city: assignToDoc.city,
        }
      : null,
  };
};

const transformFullContact = async (c) => {
  const base = {
    ...c,
    _id: c.id,
  };

  const [campaignDoc, contactTypeDoc, cityDoc, locationDoc, assignToDoc] =
    await Promise.all([
      c.Campaign
        ? prisma.contactCampaign.findFirst({
            where: { Name: c.Campaign },
            select: { id: true, Name: true },
          })
        : null,

      c.ContactType
        ? prisma.contactType.findFirst({
            where: { Name: c.ContactType },
            select: { id: true, Name: true },
          })
        : null,

      c.City
        ? prisma.city.findFirst({
            where: { Name: c.City },
            select: { id: true, Name: true },
          })
        : null,

      c.Location
        ? prisma.location.findFirst({
            where: { Name: c.Location },
            select: { id: true, Name: true },
          })
        : null,

      c.AssignToId
        ? prisma.admin.findUnique({
            where: { id: c.AssignToId },
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              city: true,
            },
          })
        : null,
    ]);

  return {
    ...base,

    Campaign: campaignDoc
      ? { _id: campaignDoc.id, Name: campaignDoc.Name }
      : { _id: null, Name: c.Campaign || "" },

    ContactType: contactTypeDoc
      ? { _id: contactTypeDoc.id, Name: contactTypeDoc.Name }
      : { _id: null, Name: c.ContactType || "" },

    City: cityDoc
      ? { _id: cityDoc.id, Name: cityDoc.Name }
      : { _id: null, Name: c.City || "" },

    Location: locationDoc
      ? { _id: locationDoc.id, Name: locationDoc.Name }
      : { _id: null, Name: c.Location || "" },

    AssignTo: assignToDoc
      ? {
          _id: assignToDoc.id,
          name: assignToDoc.name,
          email: assignToDoc.email,
          role: assignToDoc.role,
          city: assignToDoc.city,
        }
      : null,

    Address: toEmptyString(c.Address),
    ContactIndustry: toEmptyString(c.ContactIndustry),
    ContactFunctionalArea: toEmptyString(c.ContactFunctionalArea),
    ReferenceId: toEmptyString(c.ReferenceId),
    Notes: toEmptyString(c.Notes),
    Facilities: toEmptyString(c.Facilities),
    date: toEmptyString(c.date),
    Email: toEmptyString(c.Email),
    CompanyName: toEmptyString(c.CompanyName),
    Website: toEmptyString(c.Website),
    Status: toEmptyString(c.Status),
    Qualifications: toEmptyString(c.Qualifications),
  };
};

export { safeParse, transformBasicContact, transformFullContact };

export const getContact = async (req, res, next) => {
  try {
    const admin = req.admin;

    const {
      Campaign,
      ContactType,
      City,
      Location,
      Keyword,
      StartDate,
      EndDate,
      Limit,
      sort,
      User,
    } = req.query;

    let AND = [];

    // --------------------------------------------
    // ROLE-BASED FILTERS
    // --------------------------------------------
    if (admin.role === "city_admin") {
      AND.push({ City: { contains: admin.city } });
    } else if (admin.role === "user") {
      AND.push({ AssignToId: admin.id });
    }

    // --------------------------------------------
    // BASIC FILTERS (MATCH REFERENCE CONTROLLER)
    // --------------------------------------------
    if (Campaign) AND.push({ Campaign: { contains: Campaign.trim() } });

    if (ContactType)
      AND.push({ ContactType: { contains: ContactType.trim() } });

    if (City) AND.push({ City: { contains: City.trim() } });

    if (Location) AND.push({ Location: { contains: Location.trim() } });

    // --------------------------------------------
    // KEYWORD SEARCH
    // --------------------------------------------
    if (Keyword) {
      const kw = Keyword.trim();

      AND.push({
        OR: [
          { Name: { contains: kw } },
          { CompanyName: { contains: kw } },
          { Notes: { contains: kw } },
          { Email: { contains: kw } },
          { ContactNo: { contains: kw } },
        ],
      });
    }

    // --------------------------------------------
    // DATE RANGE
    // --------------------------------------------
    if (StartDate && EndDate) {
      AND.push({
        createdAt: {
          gte: new Date(StartDate),
          lte: new Date(EndDate),
        },
      });
    }

    const where = AND.length ? { AND } : {};

    let orderBy = [];

    if (sort?.toLowerCase() === "asc") {
      orderBy.push({ createdAt: "asc" });
    } else {
      orderBy.push({ updatedAt: "desc" });
      orderBy.push({ createdAt: "desc" });
    }

    // --------------------------------------------
    // MAIN FETCH
    // --------------------------------------------
    let contacts = await prisma.contact.findMany({
      where,
      orderBy,
      take: Limit ? Number(Limit) : undefined,
    });

    // --------------------------------------------
    // USER FILTER (FOLLOW REFERENCE LOGIC)
    // --------------------------------------------
    if (User) {
      const userLower = User.toLowerCase();

      const admins = await prisma.admin.findMany({
        where: {
          OR: [
            { name: { contains: User } },
            { email: { contains: User } },
            { city: { contains: User } },
            ["admin", "city_admin", "user"].includes(userLower)
              ? { role: { equals: User } }
              : undefined,
          ].filter(Boolean),
        },
        select: { id: true },
      });

      const allowedIds = admins.map((a) => a.id);

      contacts = contacts.filter(
        (c) => c.AssignToId && allowedIds.includes(c.AssignToId)
      );
    }

    const output = await Promise.all(contacts.map(transformBasicContact));

    res.status(200).json(output);
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const getContactById = async (req, res, next) => {
  try {
    const admin = req.admin;

    const c = await prisma.contact.findUnique({
      where: { id: req.params.id },
    });

    if (!c) return next(new ApiError(404, "Contact not found"));

    if (admin.role === "user" && c.AssignToId !== admin.id)
      return next(new ApiError(403, "Access denied"));

    if (admin.role === "city_admin" && c.City !== admin.city)
      return next(new ApiError(403, "Access denied"));

    const transformed = await transformFullContact(c);

    res.status(200).json(transformed);
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const createContact = async (req, res, next) => {
  try {
    const admin = req.admin;

    const data = {
      ...req.body,
      AssignToId: admin.role === "user" ? admin.id : req.body.AssignToId,
    };

    const contact = await prisma.contact.create({ data });

    res.status(201).json({ success: true, data: contact });
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

export const updateContact = async (req, res, next) => {
  try {
    const admin = req.admin;
    const id = req.params.id;

    const existing = await prisma.contact.findUnique({ where: { id } });
    if (!existing) return next(new ApiError(404, "Contact not found"));

    if (admin.role === "user" && existing.AssignToId !== admin.id)
      return next(new ApiError(403, "Access denied"));

    if (admin.role === "city_admin" && existing.City !== admin.city)
      return next(new ApiError(403, "Access denied"));

    const updated = await prisma.contact.update({
      where: { id },
      data: req.body,
    });

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

export const deleteContactbyId = async (req, res, next) => {
  try {
    const admin = req.admin;
    const id = req.params.id;

    // 1️⃣ Check if contact exists
    const contact = await prisma.contact.findUnique({
      where: { id },
    });

    if (!contact) {
      return next(new ApiError(404, "Contact not found"));
    }

    // 2️⃣ Authorization checks
    if (admin.role === "user" && contact.AssignToId !== admin.id) {
      return next(new ApiError(403, "Access denied"));
    }

    if (admin.role === "city_admin" && contact.City !== admin.city) {
      return next(new ApiError(403, "Access denied"));
    }

    // 3️⃣ Delete all confollow records linked to this contact
    await prisma.contactFollowup.deleteMany({
      where: {
        contactId: id,
      },
    });
    

    // 4️⃣ Delete the contact
    await prisma.contact.delete({
      where: { id },
    });

    res.status(200).json({ message: "Contact deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Contact not found"));
    }
    next(new ApiError(500, error.message));
  }
};


export const assignContact = async (req, res, next) => {
  try {
    const { contactIds = [], assignToId } = req.body;
    const admin = req.admin;

    if (!Array.isArray(contactIds) || contactIds.length === 0 || !assignToId) {
      return next(
        new ApiError(400, "contactIds (array) and assignToId are required")
      );
    }

    // 🔍 Fetch target admin/user
    const assignToAdmin = await prisma.admin.findUnique({
      where: { id: assignToId },
    });

    if (!assignToAdmin) return next(new ApiError(404, "Admin/User not found"));

    // 🔍 Fetch all contacts
    const contacts = await prisma.contact.findMany({
      where: { id: { in: contactIds } },
    });

    if (contacts.length === 0)
      return next(new ApiError(404, "No valid contacts found"));

    // 🧩 Role restrictions
    if (admin.role === "city_admin") {
      const invalidContacts = contacts.filter(
        (c) => (c.City || "").toLowerCase() !== (admin.city || "").toLowerCase()
      );

      if (invalidContacts.length > 0) {
        return next(
          new ApiError(403, "You can only assign contacts in your city")
        );
      }

      if (
        (assignToAdmin.city || "").toLowerCase() !==
        (admin.city || "").toLowerCase()
      ) {
        return next(
          new ApiError(403, "You can only assign to users in your city")
        );
      }
    }

    if (admin.role === "user") {
      return next(new ApiError(403, "Users cannot assign contacts"));
    }

    // ✅ Bulk update
    await prisma.contact.updateMany({
      where: { id: { in: contactIds } },
      data: { AssignToId: assignToId },
    });

    const updatedContacts = await prisma.contact.findMany({
      where: { id: { in: contactIds } },
    });

    const transformed = await Promise.all(
      updatedContacts.map((c) => transformBasicContact(c))
    );

    res.status(200).json({
      success: true,
      message: `Assigned ${transformed.length} contacts successfully`,
      data: transformed,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const bulkAssignCityContacts = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { assignToId } = req.body;

    if (admin.role !== "city_admin") {
      return next(
        new ApiError(403, "Only City Admin can assign city contacts")
      );
    }

    const targetAdmin = await prisma.admin.findUnique({
      where: { id: assignToId },
    });

    if (!targetAdmin)
      return next(new ApiError(404, "Target user/admin not found"));

    if (
      (targetAdmin.city || "").toLowerCase() !==
      (admin.city || "").toLowerCase()
    ) {
      return next(new ApiError(403, "You can only assign within your city"));
    }

    // Assign all contacts in the city
    const result = await prisma.contact.updateMany({
      where: {
        City: admin.city,
      },
      data: {
        AssignToId: assignToId,
      },
    });

    res.status(200).json({
      success: true,
      message: `Assigned ${result.count} contacts to ${targetAdmin.name}`,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const deleteAllContacts = async (req, res, next) => {
  try {
    const admin = req.admin;

    if (admin.role !== "administrator") {
      return next(new ApiError(403, "Only administrator can delete contacts"));
    }

    const { contactIds } = req.body;
    let targetContactIds=[];

    // 1️⃣ Decide which contacts to delete
    if (Array.isArray(contactIds) && contactIds.length > 0) {
      const contacts = await prisma.contact.findMany({
        where: { id: { in: contactIds } },
        select: { id: true },
      });

      if (contacts.length === 0) {
        return next(new ApiError(404, "No valid contacts found"));
      }

      targetContactIds = contacts.map(c => c.id);
    } else {
      const contacts = await prisma.contact.findMany({
        select: { id: true },
      });

      if (contacts.length === 0) {
        return next(new ApiError(404, "No contacts found to delete"));
      }

      targetContactIds = contacts.map(c => c.id);
    }

    // 2️⃣ Delete all confollow records first
    await prisma.contactFollowup.deleteMany({
      where: {
        contactId: { in: targetContactIds },
      },
    });

    // 3️⃣ Delete contacts
    await prisma.contact.deleteMany({
      where: {
        id: { in: targetContactIds },
      },
    });

    res.status(200).json({
      success: true,
      message:
        Array.isArray(contactIds) && contactIds.length > 0
          ? "Selected contacts deleted successfully"
          : "All contacts deleted successfully",
      deletedContactIds: targetContactIds,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};
