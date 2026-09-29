import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

const transformDepartment = (department) => ({
  _id: department.id,
  Name: department.Name,
  Status: department.Status,
  createdAt: department.createdAt,
  updatedAt: department.updatedAt,
});

// ---------------------------------------------------------
// GET DEPARTMENT
// ---------------------------------------------------------
export const getDepartment = async (req, res, next) => {
  try {
    const { keyword, limit } = req.query;

    let where = {};
    if (keyword) {
      where.Name = { contains: keyword.trim(), mode: "insensitive" };
    }

    const departments = await prisma.department.findMany({
      where,
      orderBy: { Name: "asc" },
      take: limit ? Number(limit) : undefined,
    });

    const transformedDepartments = await Promise.all(departments.map(transformDepartment));

    return res.status(200).json(transformedDepartments);
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// GET DEPARTMENT BY ID
export const getDepartmentById = async (req, res, next) => {
  try {
    const department = await prisma.department.findUnique({
      where: { id: req.params.id },
    });

    if (!department) return next(new ApiError(404, "Department not found"));

    res.status(200).json(transformDepartment(department));
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// CREATE DEPARTMENT
export const createDepartment = async (req, res, next) => {
  try {
    const { Name, Status } = req.body;

    const newDepartment = await prisma.department.create({
      data: { Name, Status },
    });

    res.status(201).json(transformDepartment(newDepartment));
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// UPDATE DEPARTMENT
export const updateDepartment = async (req, res, next) => {
  try {
    const { id } = req.params;

    let updateData = { ...req.body };

    delete updateData.id;
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.updatedAt;
    delete updateData.CreatedBy;
    delete updateData.designations;
    delete updateData.roleEmps;

    const updatedDepartment = await prisma.department.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json(transformDepartment(updatedDepartment));
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Department not found"));
    }
    next(new ApiError(400, error.message));
  }
};

// DELETE DEPARTMENT
export const deleteDepartment = async (req, res, next) => {
  try {
    const id = req.params.id;

    // 1️⃣ DELETE RoleEmps first (depends on Department + Designation)
    await prisma.roleEmp.deleteMany({
      where: { departmentId: id },
    });

    // 2️⃣ DELETE Designations (depends on Department)
    await prisma.designation.deleteMany({
      where: { departmentId: id },
    });

    // 3️⃣ DELETE Department
    await prisma.department.delete({
      where: { id },
    });

    res.status(200).json({ message: "Department deleted successfully" });
  } catch (error) {
    if (error.code === "P2025") {
      return next(new ApiError(404, "Department not found"));
    }
    next(new ApiError(500, error.message));
  }
};