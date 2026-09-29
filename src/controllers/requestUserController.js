import bcrypt from "bcryptjs";
import { genrateToken } from "../config/adminjwt.js";
import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";
import cloudinary from "../config/cloudinary.js";
import fs from "fs";
import { notifyNewUserRequest } from "../jobs/notification/notificationEvents.js";



export const acceptRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const currentAdmin = req.admin;

        /*         if (currentAdmin.role !== "administrator") {
                    throw new ApiError(403, "Only administrators can accept requests");
                }
         */
        if (!id) {
            throw new ApiError(400, "User ID is required");
        }

        // Find the request user
        const requestUser = await prisma.requestUser.findUnique({
            where: { id },
        });

        if (!requestUser) {
            throw new ApiError(404, "Request user not found");
        }

        // Check if email already exists in admin table
        const existingAdmin = await prisma.admin.findUnique({
            where: { email: requestUser.email },
        });

        if (existingAdmin) {
            throw new ApiError(409, "An admin with this email already exists");
        }

        // Create new admin record using the data from requestUser
        const newAdmin = await prisma.admin.create({
            data: {
                name: requestUser.name,
                email: requestUser.email,
                password: requestUser.password, // password is already hashed in requestUser
                role: requestUser.role || "client_admin", // default role if not provided
                city: requestUser.city || null,
                phone: requestUser.phone || null,
                company: requestUser.company,
                experience: requestUser.experience,
                specialization: requestUser.specialization,
                AdminImage: requestUser.image
            },
        });

        // Delete the user from  requestUser table
        await prisma.requestUser.delete({
            where: { id },
        });

        res.status(201).json({
            success: true,
            adminData: newAdmin,
            message: "Request accepted and user added successfully",
        });
    } catch (error) {
        console.log(error.message);
        res
            .status(error instanceof ApiError ? error.statusCode : 500)
            .json({ success: false, message: error.message });
    }
};


export const denyRequest = async (req, res) => {
    try {
        const { id } = req.params;

        const currentAdmin = req.admin;

        if (currentAdmin.role !== "administrator") {
            throw new ApiError(403, "Only administrators can deny request");
        }

        if (!id) {
            throw new ApiError(400, "User ID is required");
        }

        // Check if user exists
        const requestUser = await prisma.requestUser.findUnique({
            where: { id },
        });

        if (!requestUser) {
            throw new ApiError(404, "Request user not found");
        }

        // Delete from RequestUser table
        await prisma.requestUser.delete({
            where: { id },
        });

        res.status(200).json({
            success: true,
            message: "Request denied and user removed successfully",
        });
    } catch (error) {
        console.log(error.message);
        res
            .status(error instanceof ApiError ? error.statusCode : 500)
            .json({ success: false, message: error.message });
    }
};


export const getAllRequestUser = async (req, res) => {
    try {
        const requestUsers = await prisma.requestUser.findMany({
             orderBy: { createdAt: "desc" },
        });

        res.status(200).json({
            success: true,
            count: requestUsers.length,
            data: requestUsers,
        });
    } catch (error) {
        console.log(error.message);
        res
            .status(error instanceof ApiError ? error.statusCode : 500)
            .json({ success: false, message: error.message });
    }
};


export const newUserSignup = async (req, res) => {
    const { name, email, password, phone, role, experience, specialization, city,company } = req.body;

    try {
        if (!email || !password || !name || !phone) {
            throw new ApiError(400, "Missing required details");
        }

        if (role) {
            if (role !== "user" && role !== "client_admin") {
                throw new ApiError(403, "Unauthorized User Role");
            }
        }

        // Check if email already exists inside RequestUser
        const existingRequestUser = await prisma.requestUser.findFirst({
            where: { email },
        });

        if (existingRequestUser) {
            throw new ApiError(409, "Account already exists");
        }

        let AdminImage = [];

        if (req.files?.AdminImage) {
            const uploads = req.files.AdminImage.map((file) =>
                cloudinary.uploader
                    .upload(file.path, {
                        folder: "admin/admin_images",
                        transformation: [{ width: 1000, crop: "limit" }],
                    })
                    .then((upload) => {
                        fs.unlinkSync(file.path);
                        return upload.secure_url;
                    })
            );
            AdminImage = await Promise.all(uploads);
        }


        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new RequestUser
        const newUser = await prisma.requestUser.create({
            data: {
                name,
                email,
                password: hashedPassword,
                phone,
                role: role ? role : "user",
                experience,
                specialization,
                city,
                image: JSON.stringify(AdminImage),
                company
            },
        });

        const token = genrateToken(newUser.id);

            await notifyNewUserRequest({
              newUser: newUser,
            });
            console.log("Notification job triggered for new user request:", newUser.name);
        

        res.status(201).json({
            success: true,
            userData: newUser,
            token,
            message: "Account created successfully",
        });
    } catch (error) {
        console.log(error.message);
        res
            .status(error instanceof ApiError ? error.statusCode : 500)
            .json({ success: false, message: error.message });
    }
};
