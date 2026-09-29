import { PrismaClient } from "@prisma/client";
import ApiError from "../utils/ApiError.js";

const prisma = new PrismaClient();

// ---------------------------------------------------
//  HELPER FUNCTION (TRANSFORM)
// ---------------------------------------------------
const transformRoleEmp = (roleEmp) => ({
  _id: roleEmp.id,
  Name: roleEmp.Name,
  Status: roleEmp.Status,
  Department: roleEmp.Department
    ? {
        _id: roleEmp.Department.id,
        Name: roleEmp.Department.Name,
      }
    : null,
  Designation: roleEmp.Designation // 🚨 FIXED: Was CustomerType
    ? {
        _id: roleEmp.Designation.id,
        Name: roleEmp.Designation.Name,
      }
    : null,
  createdAt: roleEmp.createdAt,
  updatedAt: roleEmp.updatedAt,
});

// ---------------------------------------------------
//  GET ALL ROLES
// ---------------------------------------------------
export const getRoleEmp = async (req, res, next) => {
  try {
    const { keyword, limit, departmentId, designationId } = req.query; // 🚨 FIXED: Was typeId

    let where = {};
    if (departmentId) where.departmentId = departmentId;
    if (designationId) where.designationId = designationId; // 🚨 FIXED: Was customerTypeId
    if (keyword) {
      where.Name = { contains: keyword.trim(), mode: "insensitive" };
    }

    const roleEmps = await prisma.roleEmp.findMany({
      where,
      include: {
        Department: { select: { id: true, Name: true } },
        Designation: { select: { id: true, Name: true } }, // 🚨 FIXED
      },
      orderBy: { Name: "asc" },
      take: limit ? Number(limit) : undefined,
    });

    const transformedRoleEmps = await Promise.all(roleEmps.map(transformRoleEmp));

    return res.status(200).json(transformedRoleEmps);
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  GET ROLE BY ID
// ---------------------------------------------------
export const getRoleEmpById = async (req, res, next) => {
  try {
    const roleEmp = await prisma.roleEmp.findUnique({
      where: { id: req.params.id },
      include: {
        Department: { select: { id: true, Name: true } },
        Designation: { select: { id: true, Name: true } }, // 🚨 FIXED
      },
    });

    if (!roleEmp) {
      return next(new ApiError(404, "RoleEmp not found"));
    }

    res.status(200).json(transformRoleEmp(roleEmp));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  CREATE ROLE
// ---------------------------------------------------
export const createRoleEmp = async (req, res, next) => {
  try {
    const { Department, Designation, Name, Status } = req.body; // 🚨 FIXED: Was CustomerType

    if (!Department) return next(new ApiError(400, "Department ID is required"));
    if (!Designation) return next(new ApiError(400, "Designation ID is required"));
    if (!Name) return next(new ApiError(400, "RoleEmp name is required"));

    const newRoleEmp = await prisma.roleEmp.create({
      data: {
        Name,
        Status: Status || "Active",
        departmentId: Department,
        designationId: Designation, // 🚨 FIXED
      },
      include: {
        Department: { select: { id: true, Name: true } },
        Designation: { select: { id: true, Name: true } },
      },
    });

    res.status(201).json(transformRoleEmp(newRoleEmp));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// ---------------------------------------------------
//  UPDATE ROLE
// ---------------------------------------------------
export const updateRoleEmp = async (req, res, next) => {
  try {
    const { id } = req.params;

    let updateData = { ...req.body };

    delete updateData.id;
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.updatedAt;

    delete updateData.Department;
    delete updateData.Designation; // 🚨 FIXED: Was CustomerType

    if (req.body.Department) {
      updateData.departmentId = req.body.Department;
    }
    if (req.body.Designation) {
      updateData.designationId = req.body.Designation; // 🚨 FIXED
    }

    const updated = await prisma.roleEmp.update({
      where: { id },
      data: updateData,
      include: {
        Department: { select: { id: true, Name: true } },
        Designation: { select: { id: true, Name: true } },
      },
    });

    res.status(200).json(transformRoleEmp(updated));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "RoleEmp not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// ---------------------------------------------------
// DELETE ALL ROLES (or selected)
// ---------------------------------------------------
export const deleteRoleEmp = async (req, res, next) => {
  try {
    const { roleEmpIds } = req.body;

    let ids = roleEmpIds;
    if (typeof ids === "string") {
      try { ids = JSON.parse(ids); } catch { ids = []; }
    }
    if (!Array.isArray(ids)) ids = [];

    let roleEmpsToDelete = [];

    if (ids.length > 0) {
      roleEmpsToDelete = await prisma.roleEmp.findMany({
        where: { id: { in: ids } },
      });

      if (roleEmpsToDelete.length === 0) {
        return next(new ApiError(404, "No valid roleEmps found"));
      }
    } else {
      roleEmpsToDelete = await prisma.roleEmp.findMany();

      if (roleEmpsToDelete.length === 0) {
        return next(new ApiError(404, "No roleEmps found to delete"));
      }
    }

    const roleEmpIdsToDelete = roleEmpsToDelete.map((s) => s.id);

    await prisma.roleEmp.deleteMany({
      where: { id: { in: roleEmpIdsToDelete } },
    });

    res.status(200).json({
      success: true,
      message: ids.length > 0
          ? "Selected roleEmps deleted successfully"
          : "All roleEmps deleted successfully",
      deletedRoleEmpIds: roleEmpIdsToDelete,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  DELETE ROLE BY ID
// ---------------------------------------------------
export const deleteRoleEmpbyId = async (req, res, next) => {
  try {
    await prisma.roleEmp.delete({
      where: { id: req.params.id },
    });

    res.status(200).json({ message: "RoleEmp deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "RoleEmp not found"));
    }
    next(new ApiError(500, error.message));
  }
};