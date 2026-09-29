import { PrismaClient } from "@prisma/client";
import ApiError from "../utils/ApiError.js";

const prisma = new PrismaClient();

// ---------------------------------------------------
//  HELPER FUNCTION ( TRANSFORM RESPONSE )
// ---------------------------------------------------
const transformDesignation = (designation) => ({ // 🚨 FIXED: Parameter name
  _id: designation.id,
  Name: designation.Name,
  Status: designation.Status,
  Department: designation.Department
    ? {
        _id: designation.Department.id,
        Name: designation.Department.Name,
      }
    : null,
  createdAt: designation.createdAt,
  updatedAt: designation.updatedAt,
});

// ---------------------------------------------------
//  GET ALL DESIGNATIONS
// ---------------------------------------------------
export const getDesignation = async (req, res, next) => {
  try {
    const { keyword, limit, departmentId } = req.query;

    let where = {};
    if (departmentId) where.departmentId = departmentId;
    if (keyword) {
      where.Name = { contains: keyword.trim(), mode: "insensitive" };
    }

    const designations = await prisma.designation.findMany({
      where,
      include: {
        Department: { select: { id: true, Name: true } },
      },
      orderBy: { Name: "asc" },
      take: limit ? Number(limit) : undefined,
    });

    const transformedDesignations = await Promise.all(designations.map(transformDesignation));

    return res.status(200).json(transformedDesignations);
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  GET DESIGNATION BY ID
// ---------------------------------------------------
export const getDesignationById = async (req, res, next) => {
  try {
    const designation = await prisma.designation.findUnique({
      where: { id: req.params.id },
      include: {
        Department: {
          select: { id: true, Name: true },
        },
      },
    });

    if (!designation) return next(new ApiError(404, "Designation not found"));

    res.status(200).json(transformDesignation(designation));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  CREATE DESIGNATION
// ---------------------------------------------------
export const createDesignation = async (req, res, next) => {
  try {
    const { Department, Name, Status } = req.body;

    if (!Department) return next(new ApiError(400, "Department ID is required"));
    if (!Name) return next(new ApiError(400, "Designation name is required"));

    const designation = await prisma.designation.create({
      data: {
        Name,
        Status: Status || "Active",
        departmentId: Department,
      },
      include: {
        Department: { select: { id: true, Name: true } },
      },
    });

    res.status(201).json(transformDesignation(designation));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// ---------------------------------------------------
//  UPDATE DESIGNATION
// ---------------------------------------------------
export const updateDesignation = async (req, res, next) => {
  try {
    const { id } = req.params;

    let updateData = { ...req.body };

    delete updateData.id;
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.updatedAt;
    delete updateData.Department;

    if (req.body.Department) {
      updateData.departmentId = req.body.Department;
    }

    const updatedDesignation = await prisma.designation.update({
      where: { id },
      data: updateData,
      include: {
        Department: { select: { id: true, Name: true } },
      },
    });

    res.status(200).json(transformDesignation(updatedDesignation));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Designation not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// ---------------------------------------------------
// DELETE ALL DESIGNATIONS (or selected)
// ---------------------------------------------------
export const deleteDesignation = async (req, res, next) => {
  try {
    const { designationIds } = req.body;

    let ids = designationIds;
    if (typeof ids === "string") {
      try { ids = JSON.parse(ids); } catch { ids = []; }
    }
    if (!Array.isArray(ids)) ids = [];

    let designationsToDelete = [];

    if (ids.length > 0) {
      designationsToDelete = await prisma.designation.findMany({
        where: { id: { in: ids } },
      });

      if (designationsToDelete.length === 0) {
        return next(new ApiError(404, "No valid designations found"));
      }
    } else {
      designationsToDelete = await prisma.designation.findMany();
      if (designationsToDelete.length === 0) {
        return next(new ApiError(404, "No designations found to delete"));
      }
    }

    const designationIdsToDelete = designationsToDelete.map((t) => t.id);

    // 1️⃣ Delete all RoleEmps linked to these Designations (🚨 FIXED case sensitivity)
    await prisma.roleEmp.deleteMany({
      where: { designationId: { in: designationIdsToDelete } }, 
    });

    // 2️⃣ Delete Designations
    await prisma.designation.deleteMany({
      where: { id: { in: designationIdsToDelete } },
    });

    res.status(200).json({
      success: true,
      message: ids.length > 0
          ? "Selected designations deleted successfully"
          : "All designations deleted successfully",
      deletedDesignationIds: designationIdsToDelete,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  DELETE DESIGNATION BY ID
// ---------------------------------------------------
export const deleteDesignationbyId = async (req, res, next) => {
  try {
    const id = req.params.id;

    // 1️⃣ Delete all RoleEmps linked with this Designation (🚨 FIXED case sensitivity)
    await prisma.roleEmp.deleteMany({
      where: { designationId: id },
    });

    // 2️⃣ Delete the Designation
    await prisma.designation.delete({
      where: { id },
    });

    res.status(200).json({ message: "Designation deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Designation not found"));
    }
    next(new ApiError(500, error.message));
  }
};