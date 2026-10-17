import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import ApiError from "../utils/ApiError.js";

const prisma = new PrismaClient();



export const protectRoute = async (req, res, next) => {
  try {
    // 1. Look for headers
    const apiKey = req.headers["x-api-key"];
    const token = req.headers.token || req.cookies.token;

    if (!apiKey && !token) {
      throw new ApiError(401, "Access denied. No API key or token provided");
    }

    // ─────────────────────────────────────────────────────────────────
    // FLOW A: API KEY AUTHENTICATION (Permanent/Long-lived)
    // ─────────────────────────────────────────────────────────────────
    if (apiKey) {
      const apiKeyRecord = await prisma.cRMApiKey.findUnique({
        where: { key: apiKey },
        include: {
          admin: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              city: true,
              phone: true,
              status: true,
              clientId: true,
              AddressLine1: true,
              AddressLine2: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      });

      if (!apiKeyRecord || !apiKeyRecord.admin) {
        throw new ApiError(401, "Invalid API Key");
      }

      if (apiKeyRecord.admin.status === "inactive") {
        throw new ApiError(403, "Account has been deactivated");
      }

      // Attach admin to request and proceed
      req.admin = apiKeyRecord.admin;
      return next();
    }

    // ─────────────────────────────────────────────────────────────────
    // FLOW B: JWT AUTHENTICATION (Session-based)
    // ─────────────────────────────────────────────────────────────────
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const admin = await prisma.admin.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        city: true,
        phone: true,
        status: true,
        clientId: true,
        AddressLine1: true,
        AddressLine2: true,
        isSuperAdmin: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!admin) {
      throw new ApiError(404, "Admin not found");
    }

    if (admin.status === "inactive") {
      throw new ApiError(403, "Account has been deactivated");
    }

    req.admin = admin;
    return next();

  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Token expired" });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ---------------------------------------------
// EMPLOYEE AUTH MIDDLEWARE
// ---------------------------------------------
export const protectEmployeeRoute = async (req, res, next) => {
  try {
    const token = req.headers.employeetoken || req.cookies.employeeToken;
    if (!token){
      
      //throw new ApiError(401, "Access denied. Please log in.");
      return res.status(401).json({ 
        success: false, 
        message: "Access denied. Please log in." 
      });

    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const employee = await prisma.employee.findUnique({
      where: { id: decoded.userId },
    });

    if (!employee) {
      
      //throw new ApiError(404, "Employee not found");
      return res.status(404).json({ 
        success: false, 
        message: "Employee not found" 
      });

    }

    req.employee = employee; // Attach customer to request
    next();
  } catch (error) {
   // next(new ApiError(401, "Invalid or expired token"));
   return res.status(401).json({ 
      success: false, 
      message: "Invalid or expired token" 
    });
  }
};

// ---------------------------------------------
// CUSTOMER AUTH MIDDLEWARE
// ---------------------------------------------
export const protectCustomerRoute = async (req, res, next) => {
  try {
    const token = req.headers.customertoken || req.cookies.customerToken;
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: "Access denied. Please log in." 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const customer = await prisma.customer.findUnique({
      where: { id: decoded.userId },
    });

    if (!customer) {
      return res.status(404).json({ 
        success: false, 
        message: "Client account not found" 
      });
    }

    req.customer = customer; // Attach customer to request
    next();
  } catch (error) {
   return res.status(401).json({ 
      success: false, 
      message: "Invalid or expired token" 
    });
  }
};

// ------------------- PROTECT ROUTE -------------------
// ------------------- PROTECT ROUTE -------------------

//old protect route without apikey
/* export const protectRoute = async (req, res, next) => {
  try {
    const token = req.headers.token || req.cookies.token;

    if (!token) {
      throw new ApiError(401, "Access denied. No token provided");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 🚀 OPTIMIZED: Only select scalar fields, no relational arrays!
    const admin = await prisma.admin.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        city: true,
        phone: true,
        status: true,
        clientId: true,
        AddressLine1: true,
        AddressLine2: true,
        createdAt: true,
        updatedAt: true,
        
        // If you absolutely NEED to know how many they created in the UI context, 
        // use _count, never true.
        // _count: {
        //   select: { createdCustomers: true, createdFollowups: true }
        // }
      },
    });

    if (!admin) {
      throw new ApiError(404, "Admin not found");
    }

    if (admin.status === "inactive") {
      throw new ApiError(403, "Account has been deactivated");
    }

    req.admin = admin;
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Token expired" });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
}; */



// Check if user is administrator
export const isAdministrator = (req, res, next) => {
  try {
    if (req.admin.role !== "administrator") {
      throw new ApiError(
        403,
        "Access denied. Administrator privileges required"
      );
    }
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    } else {
      res.status(500).json({ success: false, message: error.message });
    }
  }
};

// Check if user is city admin or administrator
export const isCityAdminOrAbove = (req, res, next) => {
  try {
    if (req.admin.role !== "administrator" && req.admin.role !== "client_admin" && req.admin.role !== "city_admin") {
      throw new ApiError(
        403,
        "Access denied. City Admin or Administrator privileges required"
      );
    }
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    } else {
      res.status(500).json({ success: false, message: error.message });
    }
  }
};

// Check if user can manage specific admin

export const canManageAdmin = async (req, res, next) => {
  try {
    const targetAdminId = req.params.id || req.body.adminId;

    if (!targetAdminId) {
      throw new ApiError(400, "Admin ID is required");
    }

    const targetAdmin = await prisma.admin.findUnique({
      where: { id: targetAdminId },
    });

    if (!targetAdmin) {
      throw new ApiError(404, "Target admin not found");
    }

    const currentAdmin = req.admin;

    // Administrator can manage everyone
    if (currentAdmin.role === "administrator") {
      req.targetAdmin = targetAdmin;
      return next();
    }

    // City Admin can manage users in their city
    if (currentAdmin.role === "city_admin") {
      if (
        targetAdmin.role === "user" &&
        targetAdmin.city === currentAdmin.city
      ) {
        req.targetAdmin = targetAdmin;
        return next();
      }

      throw new ApiError(403, "You can only manage users in your city");
    }

    // Users can manage only themselves
    if (currentAdmin.role === "user") {
      if (currentAdmin.id === targetAdmin.id) {
        req.targetAdmin = targetAdmin;
        return next();
      }

      throw new ApiError(403, "You can only manage your own account");
    }

    throw new ApiError(403, "Access denied");
  } catch (error) {
    if (error instanceof ApiError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }

    return res.status(500).json({ success: false, message: error.message });
  }
};
