import prisma from "../config/prismaClient.js";
import bcrypt from "bcryptjs";

// ==========================================
// 🌐 PUBLIC ROUTE (Submit Request)
// ==========================================
export const createCustomerRequest = async (req, res, next) => {
  try {
    const { name, email, useCase, companyName, bio } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: "Name and Email are required fields",
      });
    }

    const newRequest = await prisma.customerRequest.create({
      data: {
        name,
        email,
        useCase: useCase || "",
        companyName: companyName || "",
        bio: bio || "",
        status: "pending", // Default
      },
    });

    return res.status(201).json({
      success: true,
      message: "Your request has been submitted successfully and is pending approval.",
      data: newRequest,
    });
  } catch (error) {
    console.error("Create Customer Request Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 🏢 ADMIN ROUTES
// ==========================================


// Get all requests with Pagination & Filtering
export const getCustomerRequests = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    // Parse pagination variables
    const pageNumber = Math.max(1, parseInt(page, 10));
    const pageSize = Math.max(1, parseInt(limit, 10));
    const skip = (pageNumber - 1) * pageSize;

    // Optional filter by status if provided in query string
    const whereClause = status ? { status: String(status).toLowerCase() } : {};

    // Execute count and fetch in parallel for performance
    const [totalRecords, requests] = await Promise.all([
      prisma.customerRequest.count({ where: whereClause }),
      prisma.customerRequest.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: {
          processedBy: {
            select: { name: true, email: true }, // See who processed it
          },
        },
      })
    ]);

    const totalPages = Math.ceil(totalRecords / pageSize);

    return res.status(200).json({
      success: true,
      data: requests,
      pagination: {
        totalRecords,
        totalPages,
        currentPage: pageNumber,
        pageSize
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Approve Request and convert to Customer

export const approveCustomerRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body; // 🚀 Extract password from the request body
    const adminId = req.admin.id || req.admin._id;

    // 1. Check if request exists and is pending
    const request = await prisma.customerRequest.findUnique({
      where: { id },
    });

    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }

    if (request.status !== "pending") {
      return res.status(400).json({ 
        success: false, 
        message: `Request is already ${request.status}` 
      });
    }

    // 🚀 Hash the password if one was provided
    let hashedPassword = "";
    if (password && password.trim() !== "") {
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(password, salt);
    }

    // 2. Perform Transaction (Create Customer + Update Request Status)
    const [newCustomer, updatedRequest] = await prisma.$transaction([
      
      // Step A: Create the actual customer using the mapped fields
      prisma.customer.create({
        data: {
          customerName: request.name,
          Email: request.email,
          CompanyName: request.companyName,
          Description: request.bio,
          useCase: request.useCase,
          ContactNumber: "",
          Password: hashedPassword, // 🚀 Save the hashed password
          CreatedById: adminId, 
          updatedAt: new Date(),
        },
      }),

      // Step B: Mark the temporary request as approved
      prisma.customerRequest.update({
        where: { id },
        data: {
          status: "approved",
          processedById: adminId,
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: "Customer request approved and added to CRM.",
      data: {
        customer: newCustomer,
        request: updatedRequest,
      },
    });
  } catch (error) {
    console.error("Approve Request Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Deny Request (Just updates status, no customer created)
export const denyCustomerRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id || req.admin._id;

    const request = await prisma.customerRequest.findUnique({
      where: { id },
    });

    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }

    if (request.status !== "pending") {
      return res.status(400).json({ 
        success: false, 
        message: `Request is already ${request.status}` 
      });
    }

    const updatedRequest = await prisma.customerRequest.update({
      where: { id },
      data: {
        status: "denied",
        processedById: adminId,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Customer request has been denied.",
      data: updatedRequest,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};