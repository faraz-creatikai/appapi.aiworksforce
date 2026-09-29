import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";

// Utility to generate a random Ticket ID like "TKT-8X2A9"
const generateTicketId = () => {
  return `TKT-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
};

// =========================================================
// 🧑‍💼 CUSTOMER (CLIENT PANEL) CONTROLLERS
// =========================================================

export const createCustomerEnquiry = async (req, res, next) => {
  try {
    // Assuming your protectRoute middleware attaches req.customer
    const customerId = req.customer.id; 
    const { subject, message, priority } = req.body;

    if (!subject || !message) {
      throw new ApiError(400, "Subject and Initial Message are required.");
    }

    const enquiry = await prisma.enquiry.create({
      data: {
        ticketId: generateTicketId(),
        subject,
        priority: priority || "medium",
        customerId,
        messages: {
          create: {
            message,
            customerId // Links this specific message to the customer
          }
        }
      },
      include: { messages: true }
    });

    res.status(201).json({ success: true, message: "Ticket created successfully", data: enquiry });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const getCustomerEnquiries = async (req, res, next) => {
  try {
    const customerId = req.customer.id;
    
    const enquiries = await prisma.enquiry.findMany({
      where: { customerId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { messages: true } }
      }
    });

    res.status(200).json({ success: true, data: enquiries });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const getCustomerEnquiryById = async (req, res, next) => {
  try {
    const customerId = req.customer.id;
    const { id } = req.params;

    const enquiry = await prisma.enquiry.findFirst({
      where: { id, customerId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            admin: { select: { name: true, AdminImage: true, role: true } },
            customer: { select: { customerName: true, CustomerImage: true } }
          }
        }
      }
    });

    if (!enquiry) throw new ApiError(404, "Ticket not found");

    res.status(200).json({ success: true, data: enquiry });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const replyToEnquiryAsCustomer = async (req, res, next) => {
  try {
    const customerId = req.customer.id;
    const { id } = req.params;
    const { message } = req.body;

    if (!message) throw new ApiError(400, "Message cannot be empty");

    // Ensure it belongs to them
    const enquiry = await prisma.enquiry.findFirst({ where: { id, customerId } });
    if (!enquiry) throw new ApiError(404, "Ticket not found");

    // Add message and mark the parent ticket status as 'pending' so admin knows client replied
    const updatedEnquiry = await prisma.enquiry.update({
      where: { id },
      data: {
        status: "pending", 
        messages: {
          create: { message, customerId }
        }
      },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1, // Return just the new message to append in UI
          include: { customer: { select: { customerName: true, CustomerImage: true } } }
        }
      }
    });

    res.status(201).json({ success: true, message: "Reply sent", data: updatedEnquiry.messages[0] });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// =========================================================
// 🏢 ADMIN CONTROLLERS
// =========================================================

export const getAllAdminEnquiries = async (req, res, next) => {
  try {
    const { status, search } = req.query;
    
    let whereClause = {};
    if (status && status !== "all") whereClause.status = status;
    if (search) {
      whereClause.OR = [
        { ticketId: { contains: search } },
        { subject: { contains: search } },
        { customer: { customerName: { contains: search } } }
      ];
    }

    const enquiries = await prisma.enquiry.findMany({
      where: whereClause,
      orderBy: { updatedAt: 'desc' },
      include: {
        customer: { select: { customerName: true, Email: true, CustomerImage: true } },
        _count: { select: { messages: true } }
      }
    });

    res.status(200).json({ success: true, data: enquiries });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const getAdminEnquiryById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const enquiry = await prisma.enquiry.findUnique({
      where: { id },
      include: {
        customer: { select: { customerName: true, Email: true, ContactNumber: true, CustomerImage: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            admin: { select: { name: true, AdminImage: true, role: true } },
            customer: { select: { customerName: true, CustomerImage: true } }
          }
        }
      }
    });

    if (!enquiry) throw new ApiError(404, "Ticket not found");

    res.status(200).json({ success: true, data: enquiry });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const replyToEnquiryAsAdmin = async (req, res, next) => {
  try {
    const adminId = req.admin.id;
    const { id } = req.params;
    const { message, status } = req.body; // Admin can optionally change status while replying

    if (!message) throw new ApiError(400, "Message cannot be empty");

    const updatedEnquiry = await prisma.enquiry.update({
      where: { id },
      data: {
        status: status || "open", // usually "open" means waiting on client now
        messages: {
          create: { message, adminId }
        }
      },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { admin: { select: { name: true, AdminImage: true, role: true } } }
        }
      }
    });

    res.status(201).json({ success: true, message: "Reply sent", data: updatedEnquiry.messages[0] });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const updateEnquiryStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const updated = await prisma.enquiry.update({
      where: { id },
      data: { status }
    });

    res.status(200).json({ success: true, message: `Status updated to ${status}`, data: updated });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};