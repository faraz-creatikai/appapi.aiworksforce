import fs from "fs";
import cloudinary from "../config/cloudinary.js";
import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";


// Helper: Upload file from disk path to Cloudinary, then remove local file
const uploadDiskFileToCloudinary = async (filePath, folder = "crm-branding") => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      resource_type: "image",
      overwrite: true,
    });
    return result.secure_url;
  } finally {
    // 🧹 Clean up local temp file from 'uploads/' directory after upload attempts
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
};

// ----------------------------------------------------
// 1. GET BRAND SETTINGS (Public - No Auth Required)
// ----------------------------------------------------
export const getBrandSettings = async (req, res, next) => {
  try {
    const settings = await prisma.brandSettings.findUnique({
      where: { id: 1 },
    });

    return res.status(200).json({
      success: true,
      data: settings || {},
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ----------------------------------------------------
// 2. UPDATE BRAND SETTINGS (Protected - Admin Only)
// ----------------------------------------------------
export const updateBrandSettings = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { appName, shortName, themeColor,primaryColor, backgroundColor } = req.body;

    const uploadedUrls = {};
    const fileFields = [
      { key: "favicon", dbField: "faviconUrl" },
      { key: "logoSingle", dbField: "logoIconUrl" },
      { key: "logoText", dbField: "logoTextUrl" },
      { key: "splashScreen", dbField: "splashScreenUrl" },
      { key: "icon192", dbField: "icon192Url" },
      { key: "icon512", dbField: "icon512Url" },
    ];

    // Check req.files from Multer diskStorage
    if (req.files) {
      for (const field of fileFields) {
        const fileArray = req.files[field.key];
        if (fileArray && fileArray.length > 0) {
          const localPath = fileArray[0].path; // e.g., "uploads/172224000-123456.png"
          const secureUrl = await uploadDiskFileToCloudinary(localPath);
          uploadedUrls[field.dbField] = secureUrl;
        }
      }
    }

    // Upsert ensures row id=1 exists even on first save
    const updatedSettings = await prisma.brandSettings.upsert({
      where: { id: 1 },
      update: {
        ...(appName && { appName }),
        ...(shortName && { shortName }),
        ...(primaryColor && { primaryColor }),
        ...(themeColor && { themeColor }),
        ...(backgroundColor && { backgroundColor }),
        ...uploadedUrls,
      },
      create: {
        id: 1,
        appName: appName || "EstateAI Agent Platform",
        shortName: shortName || "EstateAI",
        primaryColor: primaryColor || "#0066cc",
        ...uploadedUrls,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Branding updated successfully",
      data: updatedSettings,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};