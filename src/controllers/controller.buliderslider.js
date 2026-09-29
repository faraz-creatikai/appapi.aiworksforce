import cloudinary from "../config/cloudinary.js";
import ApiError from "../utils/ApiError.js";
import fs from "fs";
import prisma from "../config/prismaClient.js";

// Parse JSON safely
const parseJSON = (field) => {
  if (!field) return [];
  if (typeof field === "string") return JSON.parse(field);
  return field;
};

// Convert Prisma → Mongo-style response with _id
const transformBuilder = (b) => ({
  ...b,
  _id: b.id,
  Image: parseJSON(b.Image),
});

export const getBuilders = async (req, res, next) => {
  try {
    const builders = await prisma.builderSlider.findMany({
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      success: true,
      data: builders.map(transformBuilder),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const getBuilderById = async (req, res, next) => {
  try {
    const builder = await prisma.builderSlider.findUnique({
      where: { id: req.params.id },
    });

    if (!builder) return next(new ApiError(404, "Builder not found"));

    res.status(200).json({
      success: true,
      data: transformBuilder(builder),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const createBuilder = async (req, res, next) => {
  try {
    const { Status } = req.body;

    let Image = [];

    if (req.files?.Image) {
      const uploads = req.files.Image.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "builders/images",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((up) => {
            fs.unlinkSync(file.path);
            return up.secure_url;
          })
      );

      Image = await Promise.all(uploads);
    }

    const newBuilder = await prisma.builderSlider.create({
      data: {
        Status,
        Image: JSON.stringify(Image),
      },
    });

    res.status(201).json({
      success: true,
      data: transformBuilder(newBuilder),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

const getPublicIdFromUrl = (url) => {
  try {
    const parts = url.split("/");
    const file = parts[parts.length - 1];
    return file.split(".")[0];
  } catch {
    return null;
  }
};

export const updateBuilder = async (req, res, next) => {
  try {
    const { id } = req.params;
    let updateData = { ...req.body };

    // Try parsing if sent as string
    const safeParse = (value) => {
      if (!value) return undefined;
      if (Array.isArray(value)) return value;
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    };

    updateData.Image = safeParse(updateData.Image);
    updateData.removedImages = safeParse(updateData.removedImages) || [];

    // Fetch existing
    const existing = await prisma.builderSlider.findUnique({ where: { id } });
    if (!existing) return next(new ApiError(404, "Builder not found"));

    let Image = parseJSON(existing.Image);

    // 1️⃣ Remove specific images
    if (updateData.removedImages.length > 0) {
      await Promise.all(
        updateData.removedImages.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          return cloudinary.uploader.destroy(`builders/images/${publicId}`);
        })
      );

      Image = Image.filter((img) => !updateData.removedImages.includes(img));
    }

    // 2️⃣ Remove ALL images (when user sends Image = [])
    if (Array.isArray(updateData.Image) && updateData.Image.length === 0) {
      await Promise.all(
        Image.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          return cloudinary.uploader.destroy(`builders/images/${publicId}`);
        })
      );
      Image = [];
    }

    // 3️⃣ Upload new images (append)
    if (req.files?.Image) {
      const uploads = req.files.Image.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "builders/images",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );

      Image.push(...(await Promise.all(uploads)));
    }

    // Save
    const updated = await prisma.builderSlider.update({
      where: { id },
      data: {
        Status: updateData.Status,
        Image: JSON.stringify(Image),
      },
    });

    res.status(200).json({
      success: true,
      message: "Builder updated successfully",
      data: transformBuilder(updated),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const deleteBuilder = async (req, res, next) => {
  try {
    const existing = await prisma.builderSlider.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) return next(new ApiError(404, "Builder not found"));

    const images = parseJSON(existing.Image);

    await Promise.all(
      images.map((url) => {
        const publicId = getPublicIdFromUrl(url);
        return cloudinary.uploader.destroy(`builders/images/${publicId}`);
      })
    );

    await prisma.builderSlider.delete({ where: { id: req.params.id } });

    res.status(200).json({ message: "Builder deleted successfully" });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};
export const deleteAllBuilders = async (req, res, next) => {
  try {
    const all = await prisma.builderSlider.findMany();

    const deletions = [];

    all.forEach((b) => {
      const imgs = parseJSON(b.Image);
      deletions.push(
        ...imgs.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          return cloudinary.uploader.destroy(`builders/images/${publicId}`);
        })
      );
    });

    await Promise.all(deletions);
    await prisma.builderSlider.deleteMany();

    res.status(200).json({ message: "All builders deleted successfully" });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};
