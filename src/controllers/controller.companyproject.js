import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";
import fs from "fs";
import cloudinary from "../config/cloudinary.js";

// ✅ Helper to parse JSON arrays
const parseJSON = (field) => {
  if (!field) return [];
  if (typeof field === "string") return JSON.parse(field);
  return field;
};

// ✅ Helper to extract Cloudinary Public ID
const getPublicIdFromUrl = (url) => {
  try {
    const parts = url.split("/");
    const file = parts[parts.length - 1];
    return file.split(".")[0];
  } catch {
    return null;
  }
};

// ✅ Transform project JSON for frontend
const transformProject = (project) => ({
  ...project,
  _id: project.id,
  CustomerImage: parseJSON(project.CustomerImage),
  SitePlan: parseJSON(project.SitePlan),
});

// ✅ GET PROJECTS (Filter + Sort)
export const getProjects = async (req, res, next) => {
  try {
    const { ProjectName, ProjectStatus, Range, City, Limit, sort } = req.query;

    let where = {};
    if (ProjectName)
      where.ProjectName = { contains: ProjectName, mode: "insensitive" };
    if (ProjectStatus)
      where.ProjectStatus = { contains: ProjectStatus, mode: "insensitive" };
    if (Range) where.Range = { contains: Range, mode: "insensitive" };
    if (City) where.City = { contains: City, mode: "insensitive" };

    const projects = await prisma.companyProject.findMany({
      where,
      orderBy: { createdAt: sort?.toLowerCase() === "asc" ? "asc" : "desc" },
      take: Limit ? Number(Limit) : undefined,
    });

    res.status(200).json(projects.map(transformProject));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// GET SINGLE PROJECT with City & Location mapping
export const getProjectById = async (req, res, next) => {
  try {
    const project = await prisma.companyProject.findUnique({
      where: { id: req.params.id },
    });

    if (!project) return next(new ApiError(404, "Project not found"));

    // Find City document by Name
    const cityDoc = await prisma.city.findFirst({
      where: { Name: project.City },
      select: { id: true, Name: true },
    });

    // Find Location document by Name
    const locationDoc = await prisma.location.findFirst({
      where: { Name: project.Location },
      select: { id: true, Name: true },
    });

    const response = {
      ...transformProject(project),
      City: cityDoc
        ? { _id: cityDoc.id, Name: cityDoc.Name }
        : { _id: null, Name: project.City || "" },
      Location: locationDoc
        ? { _id: locationDoc.id, Name: locationDoc.Name }
        : { _id: null, Name: project.Location || "" },
    };

    res.status(200).json(response);
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ✅ CREATE PROJECT (Cloudinary uploads)
export const createProject = async (req, res, next) => {
  try {
    const {
      ProjectName,
      ProjectType,
      ProjectStatus,
      City,
      Location,
      Area,
      Range,
      Adderess,
      Facillities,
      Amenities,
      Description,
      Video,
      GoogleMap,
    } = req.body;

    let CustomerImage = [];
    let SitePlan = [];

    // Upload Customer Images
    if (req.files?.CustomerImage) {
      const uploads = req.files.CustomerImage.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "projects/project_images",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );
      CustomerImage = await Promise.all(uploads);
    }

    // Upload Site Plans
    if (req.files?.SitePlan) {
      const uploads = req.files.SitePlan.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "projects/site_plans",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );
      SitePlan = await Promise.all(uploads);
    }

    const newProject = await prisma.companyProject.create({
      data: {
        ProjectName,
        ProjectType,
        ProjectStatus,
        City,
        Location,
        Area,
        Range,
        Adderess,
        Facillities,
        Amenities,
        Description,
        Video,
        GoogleMap,
        CustomerImage: JSON.stringify(CustomerImage),
        SitePlan: JSON.stringify(SitePlan),
        CreatedBy: req.admin?.id || null,
      },
    });

    res.status(201).json({ success: true, data: transformProject(newProject) });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ✅ UPDATE PROJECT (Uploads + Deletions)
export const updateProject = async (req, res, next) => {
  try {
    const { id } = req.params;

    let updateData = { ...req.body };

    // Parse JSON arrays safely
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

    // Only parse if user actually sent these fields
    updateData.CustomerImage = safeParse(updateData.CustomerImage);
    updateData.SitePlan = safeParse(updateData.SitePlan);
    updateData.removedCustomerImages =
      safeParse(updateData.removedCustomerImages) || [];
    updateData.removedSitePlans = safeParse(updateData.removedSitePlans) || [];

    // Fetch existing project
    const existing = await prisma.companyProject.findUnique({ where: { id } });
    if (!existing) return next(new ApiError(404, "Project not found"));

    let CustomerImage = safeParse(existing.CustomerImage) || [];
    let SitePlan = safeParse(existing.SitePlan) || [];

    // 🗑️ Remove specific Customer Images
    if (updateData.removedCustomerImages.length > 0) {
      await Promise.all(
        updateData.removedCustomerImages.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          if (publicId)
            return cloudinary.uploader.destroy(
              `projects/project_images/${publicId}`
            );
        })
      );

      CustomerImage = CustomerImage.filter(
        (img) => !updateData.removedCustomerImages.includes(img)
      );
    }

    // 🗑️ Remove specific Site Plan images
    if (updateData.removedSitePlans.length > 0) {
      await Promise.all(
        updateData.removedSitePlans.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          if (publicId)
            return cloudinary.uploader.destroy(
              `projects/site_plans/${publicId}`
            );
        })
      );

      SitePlan = SitePlan.filter(
        (img) => !updateData.removedSitePlans.includes(img)
      );
    }

    // 🗑️ Remove ALL Customer Images — ONLY when user intentionally sends an empty array
    if (
      updateData.CustomerImage !== undefined &&
      Array.isArray(updateData.CustomerImage) &&
      updateData.CustomerImage.length === 0
    ) {
      await Promise.all(
        CustomerImage.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          if (publicId)
            return cloudinary.uploader.destroy(
              `projects/project_images/${publicId}`
            );
        })
      );
      CustomerImage = [];
    }

    // 🗑️ Remove ALL Site Plans — ONLY when user intentionally sends empty array
    if (
      updateData.SitePlan !== undefined &&
      Array.isArray(updateData.SitePlan) &&
      updateData.SitePlan.length === 0
    ) {
      await Promise.all(
        SitePlan.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          if (publicId)
            return cloudinary.uploader.destroy(
              `projects/site_plans/${publicId}`
            );
        })
      );
      SitePlan = [];
    }

    // 🖼️ Upload new Customer Images
    if (req.files?.CustomerImage) {
      const uploads = req.files.CustomerImage.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "projects/project_images",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );
      CustomerImage.push(...(await Promise.all(uploads)));
    }

    // 🖼️ Upload new Site Plans
    if (req.files?.SitePlan) {
      const uploads = req.files.SitePlan.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "projects/site_plans",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );
      SitePlan.push(...(await Promise.all(uploads)));
    }

    // Save images back to DB
    updateData.CustomerImage = JSON.stringify(CustomerImage);
    updateData.SitePlan = JSON.stringify(SitePlan);

    delete updateData.id;
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.updatedAt;
    delete updateData.CreatedBy;

    // Remove unwanted keys
    delete updateData.removedCustomerImages;
    delete updateData.removedSitePlans;

    // Update project
    const updatedProject = await prisma.companyProject.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      message: "Project updated successfully",
      data: transformProject(updatedProject),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ✅ DELETE PROJECT
export const deleteProject = async (req, res, next) => {
  try {
    const project = await prisma.companyProject.findUnique({
      where: { id: req.params.id },
    });
    if (!project) return next(new ApiError(404, "Project not found"));

    const CustomerImage = parseJSON(project.CustomerImage);
    const SitePlan = parseJSON(project.SitePlan);

    const deletions = [
      ...CustomerImage.map((url) =>
        cloudinary.uploader.destroy(
          `projects/project_images/${getPublicIdFromUrl(url)}`
        )
      ),
      ...SitePlan.map((url) =>
        cloudinary.uploader.destroy(
          `projects/site_plans/${getPublicIdFromUrl(url)}`
        )
      ),
    ];
    await Promise.all(deletions);

    await prisma.companyProject.delete({ where: { id: req.params.id } });

    res.status(200).json({ message: "Project deleted successfully" });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ✅ DELETE ALL PROJECTS
export const deleteAllProjects = async (req, res, next) => {
  try {
    const allProjects = await prisma.companyProject.findMany();
    const deletions = [];

    allProjects.forEach((p) => {
      const CustomerImage = parseJSON(p.CustomerImage);
      const SitePlan = parseJSON(p.SitePlan);

      deletions.push(
        ...CustomerImage.map((url) =>
          cloudinary.uploader.destroy(
            `projects/project_images/${getPublicIdFromUrl(url)}`
          )
        ),
        ...SitePlan.map((url) =>
          cloudinary.uploader.destroy(
            `projects/site_plans/${getPublicIdFromUrl(url)}`
          )
        )
      );
    });

    await Promise.all(deletions);
    await prisma.companyProject.deleteMany();

    res.status(200).json({ message: "All projects deleted successfully" });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};
