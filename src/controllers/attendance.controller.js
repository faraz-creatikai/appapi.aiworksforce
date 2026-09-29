import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";
import fs from "fs";
import cloudinary from "../config/cloudinary.js"; // Adjust path

const parseJSON = (field) => {
  if (!field) return [];
  if (typeof field === "string") {
    try {
      return JSON.parse(field);
    } catch {
      return [];
    }
  }
  return field;
};

// Utility to generate token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// Helper to get local date string YYYY-MM-DD
const getLocalDateString = (date) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().split("T")[0];
};

const transformEmployee = async (e) => {


  const base = {
    ...e,
    _id: e.id,
    EmployeeImage: parseJSON(e.EmployeeImage),
  };


  const createdByDoc = e.CreatedById
    ? await prisma.admin.findUnique({
      where: { id: e.CreatedById },
      select: { id: true, name: true, email: true },
    })
    : null;

  return {
    ...base,
    CreatedBy: createdByDoc
      ? {
        _id: createdByDoc.id,
        name: createdByDoc.name,
        email: createdByDoc.email,
      }
      : null,
  };
};

// ---------------------------------------------
// EMPLOYEE LOGIN, CHECK AUTH, LOGOUT
// ---------------------------------------------
export const employeeLogin = async (req, res, next) => {
  try {
    const { Email, Password } = req.body;

    if (!Email || !Password) throw new ApiError(400, "Missing login details");

    const employee = await prisma.employee.findFirst({
      where: { Email },
    });

    if (!employee || !employee.Password) {
      throw new ApiError(404, "Employee account not found or access not granted");
    }

    const isPasswordCorrect = await bcrypt.compare(Password, employee.Password);
    if (!isPasswordCorrect) throw new ApiError(401, "Invalid credentials");

    const token = generateToken(employee.id);

    res.cookie("employeeToken", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      success: true,
      employee: {
        id: employee.id,
        name: employee.employeeName, // Updated
        email: employee.Email,
      },
      token,
      message: "Login successful",
    });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

export const checkEmployeeAuth = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      employee: {
        id: req.employee.id,
        name: req.employee.employeeName, // Updated
        email: req.employee.Email,
        EmployeeImage: req.employee.EmployeeImage // Updated
      }
    });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

export const employeeLogout = async (req, res, next) => {
  try {
    res.cookie("employeeToken", "", {
      httpOnly: true,
      expires: new Date(0),
    });

    res.status(200).json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

export const getEmployeeById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) return next(new ApiError(404, "Employee not found"));


    const response = await transformEmployee(employee);
    res.status(200).json(response);
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};





// Helper to extract cloudinary public ID
const getPublicIdFromUrl = (url) => {
  if (!url) return null;
  const parts = url.split("/");
  const fileString = parts[parts.length - 1];
  return fileString.split(".")[0];
};

const safeParse = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};


// ---------------------------------------------
// GET ALL EMPLOYEES (With Dynamic Filtering & Pagination)
// ---------------------------------------------
export const getEmployees = async (req, res, next) => {
  try {
    const admin = req.admin;

    const {
      Department, Designation, Role, City, Location, SubLocation,
      EmployeeId, ContactNumber, Email, Keyword, StartDate, EndDate,
      Limit, Skip = 0, sort
    } = req.query;

    let AND = [];
    const REQUIRED = Limit !== undefined ? Number(Limit) : 100;
    const offset = Number(Skip);

    // --------------------------------------------
    // 1. ROLE-BASED ACCESS CONTROL
    // --------------------------------------------
    if (admin.role !== "administrator") {
      // Example: Client admins only see their own company's employees
      if (admin.clientId) {
        AND.push({ ClientId: admin.clientId });
      }
      // Example: City admins only see employees in their city
      if (admin.role === "city_admin" && admin.city) {
        AND.push({ City: admin.city });
      }
    }

    // --------------------------------------------
    // 2. EXACT MATCH FILTERS
    // --------------------------------------------
    if (Department) AND.push({ Department: { contains: Department.trim() } });
    if (Designation) AND.push({ Designation: { contains: Designation.trim() } });
    if (Role) AND.push({ Role: { contains: Role.trim() } });
    if (City) AND.push({ City: { contains: City.trim() } });
    if (Location) AND.push({ Location: { contains: Location.trim() } });
    if (SubLocation) AND.push({ SubLocation: { contains: SubLocation.trim() } });
    if (EmployeeId) AND.push({ EmployeeId: { contains: EmployeeId.trim() } });
    if (ContactNumber) AND.push({ ContactNumber: { contains: ContactNumber.trim() } });
    if (Email) AND.push({ Email: { contains: Email.trim() } });

    // --------------------------------------------
    // 3. DATE RANGE FILTERS
    // --------------------------------------------
    if (StartDate && EndDate) {
      AND.push({
        createdAt: {
          gte: new Date(StartDate),
          lte: new Date(EndDate)
        }
      });
    }

    // --------------------------------------------
    // 4. GLOBAL KEYWORD SEARCH
    // --------------------------------------------
    if (Keyword && Keyword.trim() !== "") {
      const kw = Keyword.trim();
      AND.push({
        OR: [
          { employeeName: { contains: kw } },
          { Email: { contains: kw } },
          { ContactNumber: { contains: kw } },
          { Department: { contains: kw } },
          { Designation: { contains: kw } },
          { EmployeeId: { contains: kw } },
          { City: { contains: kw } }
        ]
      });
    }

    const where = AND.length ? { AND } : {};
    const isAsc = sort?.toLowerCase() === "asc";
    const orderBy = isAsc ? { createdAt: "asc" } : { createdAt: "desc" };

    // --------------------------------------------
    // 5. EXECUTION & PAGINATION
    // --------------------------------------------
    const [totalRecords, employees] = await Promise.all([
      prisma.employee.count({ where }),
      prisma.employee.findMany({
        where,
        orderBy,
        skip: offset,
        take: REQUIRED,
      })
    ]);

    // Optional but highly recommended: Send the totalRecords back in headers
    res.setHeader('X-Total-Count', totalRecords);

    return res.status(200).json({
      success: true,
      total: totalRecords,
      data: employees
    });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------
// CREATE EMPLOYEE
// ---------------------------------------------
export const createEmployee = async (req, res, next) => {
  try {
    const admin = req.admin;
    const body = { ...req.body };

    // Password Hashing
    if (body.Password) {
      const salt = await bcrypt.genSalt(10);
      body.Password = await bcrypt.hash(body.Password, salt);
    }

    // Handle Image Upload
    let EmployeeImage = [];
    if (req.files?.EmployeeImage) {
      const uploads = req.files.EmployeeImage.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "employee/employee_images",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );
      EmployeeImage = await Promise.all(uploads);
    }

    const newEmployee = await prisma.employee.create({
      data: {
        ...body,
        ClientId: admin.clientId || body.ClientId,
        Email: body.Email || undefined,
        EmployeeImage: JSON.stringify(EmployeeImage),
        CreatedById: admin._id || admin.id,
      },
    });

    res.status(201).json({ success: true, data: newEmployee });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------
// UPDATE EMPLOYEE
// ---------------------------------------------
export const updateEmployee = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { id } = req.params;
    let updateData = { ...req.body };

    // Fetch existing
    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) return next(new ApiError(404, "Employee not found"));

    // Password Hashing
    if (updateData.Password && updateData.Password.trim() !== "") {
      const salt = await bcrypt.genSalt(10);
      updateData.Password = await bcrypt.hash(updateData.Password, salt);
    } else {
      delete updateData.Password; // Don't overwrite with empty string
    }

    // Parse image payloads
    updateData.EmployeeImage = safeParse(updateData.EmployeeImage);
    updateData.removedEmployeeImages = safeParse(updateData.removedEmployeeImages) || [];

    // Load existing images safely
    let EmployeeImage = safeParse(existing.EmployeeImage) || [];
    if (typeof existing.EmployeeImage === "string") {
      try { EmployeeImage = JSON.parse(existing.EmployeeImage); } catch { EmployeeImage = []; }
    }

    // 1. Destroy explicitly removed images
    if (updateData.removedEmployeeImages.length > 0) {
      await Promise.all(
        updateData.removedEmployeeImages.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          if (publicId) return cloudinary.uploader.destroy(`employee/employee_images/${publicId}`);
        })
      );
      EmployeeImage = EmployeeImage.filter(img => !updateData.removedEmployeeImages.includes(img));
    }

    // 2. Destroy ALL images if empty array was passed
    if (Array.isArray(updateData.EmployeeImage) && updateData.EmployeeImage.length === 0) {
      await Promise.all(
        EmployeeImage.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          if (publicId) return cloudinary.uploader.destroy(`employee/employee_images/${publicId}`);
        })
      );
      EmployeeImage = [];
    }

    // 3. Upload new images
    if (req.files?.EmployeeImage) {
      const uploads = req.files.EmployeeImage.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: "employee/employee_images",
            transformation: [{ width: 1000, crop: "limit" }],
          })
          .then((upload) => {
            fs.unlinkSync(file.path);
            return upload.secure_url;
          })
      );
      EmployeeImage.push(...(await Promise.all(uploads)));
    }

    updateData.EmployeeImage = JSON.stringify(EmployeeImage);
    delete updateData.removedEmployeeImages;
    delete updateData["removedEmployeeImages "];

    updateData.updatedAt = new Date();

    const updated = await prisma.employee.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      message: "Employee updated successfully",
      data: updated,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------
// DELETE MULTIPLE EMPLOYEES
// ---------------------------------------------
export const deleteEmployees = async (req, res, next) => {
  try {
    const admin = req.admin;
    if (admin.role !== "administrator") {
      return next(new ApiError(403, "Only administrator can delete employees"));
    }

    const { employeeIds } = req.body;
    let ids = typeof employeeIds === "string" ? safeParse(employeeIds) : employeeIds;
    if (!Array.isArray(ids)) ids = [];

    let employeesToDelete = [];
    if (ids.length > 0) {
      employeesToDelete = await prisma.employee.findMany({ where: { id: { in: ids } } });
      if (employeesToDelete.length === 0) return next(new ApiError(404, "No valid employees found"));
    } else {
      employeesToDelete = await prisma.employee.findMany();
      if (employeesToDelete.length === 0) return next(new ApiError(404, "No employees found to delete"));
    }

    // Clear Cloudinary Images
    const deletions = [];
    for (const emp of employeesToDelete) {
      const EmployeeImage = safeParse(emp.EmployeeImage);
      if (EmployeeImage?.length) {
        deletions.push(
          ...EmployeeImage.map((url) =>
            cloudinary.uploader.destroy(`employee/employee_images/${getPublicIdFromUrl(url)}`)
          )
        );
      }
    }
    await Promise.allSettled(deletions);

    // Delete from DB
    if (ids.length > 0) {
      await prisma.employee.deleteMany({ where: { id: { in: ids } } });
    } else {
      await prisma.employee.deleteMany({});
    }

    res.status(200).json({
      success: true,
      message: ids.length > 0 ? "Selected employees deleted successfully" : "All employees deleted successfully",
      deletedIds: ids.length > 0 ? ids : employeesToDelete.map((c) => c.id),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------
// CLOCK IN & OUT (Employee Route)
// ---------------------------------------------
export const clockIn = async (req, res, next) => {
  try {
    const employeeId = req.employee.id;
    const now = new Date();
    const dateString = getLocalDateString(now);

    const existing = await prisma.employeeAttendance.findUnique({
      where: { employeeId_dateString: { employeeId, dateString } } // Updated Index
    });

    if (existing) throw new ApiError(400, "You have already clocked in today");

    const currentHour = now.getHours();
    let initialStatus = "present";
    if (currentHour >= 12.5) initialStatus = "half_day";

    const attendance = await prisma.employeeAttendance.create({
      data: {
        employeeId,
        dateString,
        clockIn: now,
        status: initialStatus,
      }
    });

    res.status(200).json({ success: true, message: "Clocked in successfully", attendance });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

export const clockOut = async (req, res, next) => {
  try {
    const employeeId = req.employee.id;
    const now = new Date();
    const dateString = getLocalDateString(now);

    const attendance = await prisma.employeeAttendance.findUnique({
      where: { employeeId_dateString: { employeeId, dateString } } // Updated Index
    });

    if (!attendance) throw new ApiError(404, "No clock-in record found for today");
    if (attendance.clockOut) throw new ApiError(400, "You have already clocked out today");

    let finalClockOut = now;
    const endOfDayCap = new Date(now);
    endOfDayCap.setHours(18, 30, 0, 0);
    if (finalClockOut > endOfDayCap) finalClockOut = endOfDayCap;

    const diffMs = finalClockOut.getTime() - attendance.clockIn.getTime();
    const totalMinutes = Math.floor(diffMs / 60000);

    let finalStatus = attendance.status;
    if (totalMinutes < 300) finalStatus = "half_day";

    const updated = await prisma.employeeAttendance.update({
      where: { id: attendance.id },
      data: {
        clockOut: finalClockOut,
        totalMinutes,
        status: finalStatus,
        isAutoStopped: now > endOfDayCap
      }
    });

    res.status(200).json({ success: true, message: "Clocked out successfully", data: updated });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

// ---------------------------------------------
// ADMIN UPDATE ATTENDANCE
// ---------------------------------------------
export const adminUpdateAttendance = async (req, res, next) => {
  try {
    const adminId = req.admin.id;
    const { employeeId, dateString, status, clockIn, clockOut, notes } = req.body;

    if (!employeeId || !dateString || !status) {
      throw new ApiError(400, "Missing required fields");
    }

    let calculatedMinutes = 0;
    let finalStatus = status;

    if (clockIn && clockOut) {
      const diffMs = new Date(clockOut).getTime() - new Date(clockIn).getTime();
      calculatedMinutes = Math.max(0, Math.floor(diffMs / 60000));

      // 🚨 FIX: Re-evaluate status based on minutes if the admin marked them as "present"
      // Office hours: Less than 5 hours (300 mins) is mathematically a half day
      if (finalStatus === "present" && calculatedMinutes < 360) {
        finalStatus = "half_day";
      }
      else if (finalStatus === "half_day" && calculatedMinutes > 360) {
        finalStatus = "present";
      }
    }

    const attendance = await prisma.employeeAttendance.upsert({
      where: {
        employeeId_dateString: { employeeId, dateString }
      },
      update: {
        status: finalStatus, // 🚨 FIX: use the recalculated finalStatus
        clockIn: clockIn ? new Date(clockIn) : null,
        clockOut: clockOut ? new Date(clockOut) : null,
        totalMinutes: calculatedMinutes,
        notes,
        markedByAdminId: adminId
      },
      create: {
        employeeId,
        dateString,
        status: finalStatus, // 🚨 FIX: use the recalculated finalStatus
        clockIn: clockIn ? new Date(clockIn) : null,
        clockOut: clockOut ? new Date(clockOut) : null,
        totalMinutes: calculatedMinutes,
        notes,
        markedByAdminId: adminId
      }
    });

    res.status(200).json({ success: true, message: "Attendance manually updated", data: attendance });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};


export const getAdminAttendanceReport = async (req, res, next) => {
  try {
    const { startDate, endDate, search, statuses, limit = 50, skip = 0 } = req.query;

    const employeeWhere = {};

    if (search) {
      employeeWhere.employeeName = { contains: search }; // Updated
    }

    if (statuses) {
      const statusArray = statuses.split(",");
      employeeWhere.attendanceLogs = {
        some: {
          dateString: { gte: startDate, lte: endDate },
          status: { in: statusArray }
        }
      };
    }

    const employees = await prisma.employee.findMany({
      where: employeeWhere,
      select: { id: true, employeeName: true, ContactNumber: true, Email: true, EmployeeImage: true }, // Updated
      take: Number(limit),
      skip: Number(skip),
      orderBy: { employeeName: 'asc' } // Updated
    });

    const employeeIds = employees.map(e => e.id);

    const records = await prisma.employeeAttendance.findMany({ // Updated table
      where: {
        employeeId: { in: employeeIds }, // Updated
        dateString: { gte: startDate, lte: endDate }
      }
    });

    const groupedData = employees.map(emp => {
      const empRecords = records.filter(r => r.employeeId === emp.id); // Updated
      const weeklyData = {};

      empRecords.forEach(r => { weeklyData[r.dateString] = r; });

      let avatar = null;
      try {
        const imgArray = typeof emp.EmployeeImage === "string" ? JSON.parse(emp.EmployeeImage) : emp.EmployeeImage;
        if (Array.isArray(imgArray) && imgArray.length > 0) avatar = imgArray[0];
      } catch (e) { }

      return {
        employeeId: emp.id,
        employee: { employeeName: emp.employeeName, ContactNumber: emp.ContactNumber, image: avatar }, // Updated
        weeklyData
      };
    });

    const summaryRecords = await prisma.employeeAttendance.findMany({
      where: { dateString: { gte: startDate, lte: endDate } },
      select: { status: true }
    });

    const summary = { present: 0, half_day: 0, workfromhome: 0, leave: 0, absent: 0 };
    summaryRecords.forEach(r => {
      if (summary[r.status] !== undefined) summary[r.status]++;
    });

    res.status(200).json({ success: true, summary, data: groupedData, totalFetched: employees.length });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

export const getEmployeeAttendanceReport = async (req, res, next) => {
  try {
    const employeeId = req.employee.id;
    const { startDate, endDate } = req.query;

    const employeeData = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, employeeName: true, Email: true, ContactNumber: true, City: true, Adderess: true, EmployeeImage: true }
    });
    if (!employeeData) throw new ApiError(404, "Employee not found");

    let avatar = null;
    try {
      const imgArray = typeof employeeData.EmployeeImage === "string" ? JSON.parse(employeeData.EmployeeImage) : employeeData.EmployeeImage;
      if (Array.isArray(imgArray) && imgArray.length > 0) avatar = imgArray[0];
    } catch (e) { }

    const attendanceRecords = await prisma.employeeAttendance.findMany({
      where: { employeeId, dateString: { gte: startDate, lte: endDate } }, // Updated
      orderBy: { dateString: 'asc' }
    });

    const weeklyData = {};
    let totalMinutesWeek = 0;

    attendanceRecords.forEach(r => {
      weeklyData[r.dateString] = r;
      totalMinutesWeek += (r.totalMinutes || 0);
    });

    const stats = {
      present: 0, half_day: 0, workfromhome: 0, absent: 0, leave: 0,
      totalHours: (totalMinutesWeek / 60).toFixed(1)
    };

    attendanceRecords.forEach((record) => {
      if (stats[record.status] !== undefined) stats[record.status]++;
    });

    res.status(200).json({
      success: true, stats, weeklyData,
      employeeProfile: { name: employeeData.employeeName, email: employeeData.Email, phone: employeeData.ContactNumber, city: employeeData.City, address: employeeData.Adderess, image: avatar }
    });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

export const employeeManualUpdate = async (req, res, next) => {
  try {
    const employeeId = req.employee.id;
    const { dateString, status, notes } = req.body;

    if (!dateString || !status || !notes) throw new ApiError(400, "Date, status, and a reason (notes) are strictly required.");
    if (!["leave", "workfromhome"].includes(status)) throw new ApiError(403, "You can only manually request 'Leave' or 'Work From Home'.");

    const existingRecord = await prisma.employeeAttendance.findUnique({
      where: { employeeId_dateString: { employeeId, dateString } } // Updated
    });

    if (existingRecord && existingRecord.clockIn) throw new ApiError(400, "Cannot change status manually after clocking in. Contact admin.");

    const attendance = await prisma.employeeAttendance.upsert({
      where: { employeeId_dateString: { employeeId, dateString } },
      update: { status, notes },
      create: { employeeId, dateString, status, notes }
    });

    res.status(200).json({ success: true, message: `Successfully marked as ${status.replace("_", " ")}`, data: attendance });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

// Overview & Trends
export const getAttendanceTrend = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) throw new ApiError(400, "startDate and endDate are required");

    const attendanceRecords = await prisma.employeeAttendance.findMany({
      where: { dateString: { gte: startDate, lte: endDate } },
      select: { dateString: true, status: true }
    });

    const getDaysArray = (start, end) => {
      let arr = [];
      for (let dt = new Date(start); dt <= new Date(end); dt.setDate(dt.getDate() + 1)) {
        arr.push(new Date(dt).toISOString().split('T')[0]);
      }
      return arr;
    };

    const dateRange = getDaysArray(startDate, endDate);
    const trendData = dateRange.map(dateStr => {
      const dayRecords = attendanceRecords.filter(r => r.dateString === dateStr);
      let presentCount = 0; let absentCount = 0;

      dayRecords.forEach(r => {
        if (['present', 'half_day', 'workfromhome'].includes(r.status)) presentCount++;
        else if (['absent', 'leave'].includes(r.status)) absentCount++;
      });

      const dayName = new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short' });
      return { date: dateStr, name: dayName, Present: presentCount, Absent: absentCount };
    });

    res.status(200).json({ success: true, data: trendData });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};

export const getAttendanceOverview = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) throw new ApiError(400, "startDate and endDate are required");

    const groupedRecords = await prisma.employeeAttendance.groupBy({ // Updated Table
      by: ['status'],
      _count: { id: true },
      where: { dateString: { gte: startDate, lte: endDate } }
    });

    let totalRecords = 0;
    const formattedData = groupedRecords.map(record => {
      totalRecords += record._count.id;
      let displayName = record.status;
      if (displayName === 'half_day') displayName = 'Late / Half Day';
      else if (displayName === 'workfromhome') displayName = 'Work From Home';
      else displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);

      return { name: displayName, value: record._count.id };
    });

    const finalData = formattedData.map(item => ({
      ...item,
      percentage: totalRecords > 0 ? Math.round((item.value / totalRecords) * 100) : 0
    })).sort((a, b) => b.value - a.value);

    res.status(200).json({ success: true, total: totalRecords, data: finalData });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, error.message));
  }
};