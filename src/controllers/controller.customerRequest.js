import { clientUrl } from "../config/cors-origins.js";
import { sendEmail } from "../config/mailer.js";
import prisma from "../config/prismaClient.js";
import bcrypt from "bcryptjs";
import { notifyNewCustomerRequest } from "../jobs/notification/notificationEvents.js";

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

        notifyNewCustomerRequest({ requestData: newRequest });

        return res.status(201).json({
            success: true,
            message: "Your request has been submitted successfully , wait for admin approval",
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

// Import your sendEmail function at the top of the file

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
        const isPasswordProvided = password && password.trim() !== "";
        if (isPasswordProvided) {
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

        // 3. 🚀 Send Approval Email
        try {
            const loginUrl = `${clientUrl}/client/login` || "https://app.aiworksforce.com/client/login"; // Fallback to production URL if clientUrl is not set

            // Conditionally show the password or instructions to set one
            const passwordHtml = isPasswordProvided
                ? `<p style="margin: 5px 0;"><strong>Password:</strong> ${password}</p>`
                : `<p style="margin: 5px 0; color: #555; font-size: 13px;"><em>Please use the "Forgot Password" link on the login page to set your password.</em></p>`;

            const emailHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; color: #1f2937;">
                    <h2 style="color: #0066cc; margin-top: 0;">Account Approved</h2>
                    <p>Hi <strong>${request.name}</strong>,</p>
                    <p>Great news! Your request for CRM access has been approved.</p>
                    
                    <div style="background-color: #f3f4f6; padding: 16px; border-radius: 6px; margin: 20px 0;">
                        <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 16px; color: #111827;">Your Login Details</h3>
                        <p style="margin: 5px 0;"><strong>Email:</strong> ${request.email}</p>
                        ${passwordHtml}
                    </div>

                    <a href="${loginUrl}" style="display: inline-block; background-color: #0066cc; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 10px;">
                        Go to Login
                    </a>
                </div>
            `;

            await sendEmail(
                request.email,
                "Your Account has been Approved",
                emailHtml
            );
        } catch (emailError) {
            // ⚠️ Catch email errors separately so the approval doesn't fail if the email service is down
            console.error("Failed to send approval email:", emailError.message);
        }

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



// Bulk Delete Requests
export const deleteCustomerRequests = async (req, res) => {
    try {
        const { ids } = req.body; // Expects an array of string IDs

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: "No IDs provided for deletion" });
        }

        const result = await prisma.customerRequest.deleteMany({
            where: {
                id: { in: ids },
            },
        });

        return res.status(200).json({
            success: true,
            message: `Successfully deleted ${result.count} request(s).`,
        });
    } catch (error) {
        console.error("Delete Requests Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};