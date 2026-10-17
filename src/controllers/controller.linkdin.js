import cloudinary from "../config/cloudinary.js";
import prisma from "../config/prismaClient.js";
import { getValidLinkedInToken } from "../jobs/linkedinTokenService.js";
import fs from "fs";


const getLinkedinVersion = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 2); 
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}${month}`;
};


// ==========================================
// 🔗 GENERATE LINKEDIN LOGIN URL
// ==========================================
// ==========================================
// 🔗 GENERATE LINKEDIN LOGIN URL
// ==========================================
export const getAuthUrl = async (req, res) => {
    try {
        const scopes = "openid profile email w_member_social";
        const state = req.admin.id; 

        // 👈 FIX: Added encodeURIComponent() around the redirect_uri
        const encodedRedirect = encodeURIComponent(process.env.LINKEDIN_REDIRECT_URI.trim());
        const encodedScopes = encodeURIComponent(scopes);

        const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${process.env.LINKEDIN_CLIENT_ID}&redirect_uri=${encodedRedirect}&state=${state}&scope=${encodedScopes}`;

        return res.status(200).json({
            success: true,
            data: { url: authUrl },
        });
    } catch (error) {
        console.error("Get LinkedIn Auth URL Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔄 HANDLE OAUTH CALLBACK & SAVE ACCOUNT
// ==========================================
export const handleOAuthCallback = async (req, res) => {
    try {
        const { code, state } = req.body;
        const adminId = req.admin.id;

        // Security check to prevent CSRF attacks
        if (state !== adminId) {
            return res.status(400).json({ success: false, message: "Invalid state parameter." });
        }

        if (!code) {
            return res.status(400).json({ success: false, message: "Authorization code is missing." });
        }

        // 1. Exchange code for Access Token using native fetch
        const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code: code,
                client_id: process.env.LINKEDIN_CLIENT_ID,
                client_secret: process.env.LINKEDIN_CLIENT_SECRET,
                redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
            }),
        });

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            throw new Error(tokenData.error_description || "Failed to fetch LinkedIn access token.");
        }

        // 2. Fetch User Profile Info using the new token
        const userResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
            method: "GET",
            headers: { 
                "Authorization": `Bearer ${tokenData.access_token}` 
            },
        });

        const userData = await userResponse.json();

        if (!userResponse.ok) {
            throw new Error(userData.message || "Failed to fetch LinkedIn user profile.");
        }

        // LinkedIn OpenID 'sub' is the unique member ID. The URN required for posting is urn:li:person:{sub}
        const personUrn = `urn:li:person:${userData.sub}`;

        // Calculate Expiration Dates
        const accessExpireDate = new Date(Date.now() + tokenData.expires_in * 1000);
        const refreshExpireDate = tokenData.refresh_token_expires_in 
            ? new Date(Date.now() + tokenData.refresh_token_expires_in * 1000) 
            : null;

            const email = userData.email || null;
    const locale = userData.locale ? `${userData.locale.language}_${userData.locale.country}` : null;

        // 3. Upsert the account in Prisma (Create if new, Update if exists)
        const linkedinAccount = await prisma.linkedinAccount.upsert({
            where: { adminId: adminId },
            update: {
                accessToken: tokenData.access_token,
                accessTokenExpiresAt: accessExpireDate,
                refreshToken: tokenData.refresh_token || null,
                refreshTokenExpiresAt: refreshExpireDate,
                name: userData.name,
                profilePicture: userData.picture,
                linkedinId: userData.sub,
                personUrn: personUrn,
                email: email,   
            locale: locale, 
            },
            create: {
                adminId: adminId,
                accessToken: tokenData.access_token,
                accessTokenExpiresAt: accessExpireDate,
                refreshToken: tokenData.refresh_token || null,
                refreshTokenExpiresAt: refreshExpireDate,
                name: userData.name,
                profilePicture: userData.picture,
                linkedinId: userData.sub,
                personUrn: personUrn,
                email: email,   
                locale: locale,
            }
        });

        return res.status(200).json({
            success: true,
            message: "LinkedIn account connected successfully.",
            data: {
                name: linkedinAccount.name,
                profilePicture: linkedinAccount.profilePicture,
            }
        });

    } catch (error) {
        console.error("LinkedIn OAuth Callback Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 🔌 DISCONNECT LINKEDIN ACCOUNT
// ==========================================
export const disconnectAccount = async (req, res) => {
    try {
        const adminId = req.admin.id;

        // Delete the record from database
        await prisma.linkedinAccount.delete({
            where: { adminId: adminId }
        });

        return res.status(200).json({
            success: true,
            message: "LinkedIn account disconnected successfully."
        });
    } catch (error) {
        // If the record doesn't exist, prisma throws a specific error, we can ignore it or handle it
        if (error.code === 'P2025') {
             return res.status(400).json({ success: false, message: "No LinkedIn account found to disconnect." });
        }
        console.error("Disconnect LinkedIn Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 📊 GET CURRENT ACCOUNT STATUS
// ==========================================
export const getAccountStatus = async (req, res) => {
    try {
        const adminId = req.admin.id;

        const account = await prisma.linkedinAccount.findUnique({
            where: { adminId: adminId },
            select: {
                name: true,
                profilePicture: true,
                updatedAt: true,
                accessTokenExpiresAt: true,
                email: true,         // 👈 Fetch email
                locale: true,
                personUrn: true
            }
        });

        if (!account) {
            return res.status(200).json({ success: true, data: { isConnected: false } });
        }

        // Check if token needs to be refreshed (optional frontend indicator)
        const isExpired = new Date() > new Date(account.accessTokenExpiresAt);

        return res.status(200).json({
            success: true,
            data: {
                isConnected: true,
                name: account.name,
                email: account.email,
                profilePicture: account.profilePicture,
                isExpired: isExpired,
                lastUpdated: account.updatedAt,
                locale: account.locale,
                profileUrl: profileUrl,
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};



// ==========================================
// 📝📷 CREATE LINKEDIN POST (Text, Image, or Both)
// ==========================================


export const createPost = async (req, res) => {
    try {
        // FormData sends fields in req.body
        const text = req.body.caption || req.body.text || "";
        const adminId = req.admin.id;

        // 1. Upload file to Cloudinary if it exists
        let imageUrl = null;
        if (req.file) {
            const uploadRes = await cloudinary.uploader.upload(req.file.path, {
                folder: "social/linkedin_posts",
            });
            imageUrl = uploadRes.secure_url;
            fs.unlinkSync(req.file.path); // clean up local multer file
        }

        if (!text && !imageUrl) {
            return res.status(400).json({ success: false, message: "Provide text or image." });
        }

        const { accessToken, personUrn } = await getValidLinkedInToken(adminId);
        
        const headers = {
            "Authorization": `Bearer ${accessToken}`,
            "Linkedin-Version": getLinkedinVersion(),
            "X-Restli-Protocol-Version": "2.0.0"
        };

        let imageUrn = null;

        // 2. Upload to LinkedIn if we have a Cloudinary URL
        if (imageUrl) {
            const initResponse = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ initializeUploadRequest: { owner: personUrn } })
            });

            const initData = await initResponse.json();
            if (!initResponse.ok) throw new Error("Failed to init LinkedIn image upload.");

            const uploadUrl = initData.value.uploadUrl;
            imageUrn = initData.value.image;

            const imageFileResponse = await fetch(imageUrl);
            const imageBuffer = await imageFileResponse.arrayBuffer();

            const uploadResponse = await fetch(uploadUrl, {
                method: "PUT",
                headers: { 
                    "Authorization": `Bearer ${accessToken}`,
                    "Content-Type": "application/octet-stream" 
                },
                body: imageBuffer
            });
            if (!uploadResponse.ok) throw new Error("Failed to upload image to LinkedIn.");
        }

        // 3. Publish to LinkedIn Feed
        const postPayload = {
            author: personUrn,
            visibility: "PUBLIC",
            distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
            lifecycleState: "PUBLISHED",
            isReshareDisabledByAuthor: false
        };

        if (text) postPayload.commentary = text;
        if (imageUrn) postPayload.content = { media: { id: imageUrn } };

        const postResponse = await fetch("https://api.linkedin.com/rest/posts", {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify(postPayload)
        });

        if (!postResponse.ok) throw new Error("Failed to publish post.");
        const idHeader = postResponse.headers.get("x-restli-id");

        // 4. ✨ FIX PRISMA CRASH ✨
        // We removed `imageUrl: String` from this block so it doesn't crash the DB
        const savedRecord = await prisma.scheduledPost.create({
            data: {
                content: text || "Image only post",
                status: "published",
                platform: "linkedin",
                adminId: adminId,
                // Only add media/imageUrl here if your schema actually supports it!
            }
        });

        return res.status(200).json({ success: true, message: "Published successfully." });

    } catch (error) {
        console.error("LinkedIn Publish Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 📋 GET LINKEDIN POSTS (WITH PAGINATION)
// ==========================================
export const getLinkedinPosts = async (req, res) => {
    try {
        const adminId = req.admin.id;
        const { page = 1, limit = 10 } = req.query;

        const pageNumber = Math.max(1, parseInt(page, 10));
        const pageSize = Math.max(1, parseInt(limit, 10));
        const skip = (pageNumber - 1) * pageSize;

        // Fetch total count and paginated posts in parallel
        const [totalRecords, posts] = await Promise.all([
            prisma.scheduledPost.count({
                where: { adminId: adminId, platform: "linkedin" }
            }),
            prisma.scheduledPost.findMany({
                where: { adminId: adminId, platform: "linkedin" },
                orderBy: { createdAt: "desc" },
                skip: skip,
                take: pageSize,
            })
        ]);

        const totalPages = Math.ceil(totalRecords / pageSize);

        return res.status(200).json({
            success: true,
            data: posts,
            pagination: {
                totalRecords,
                totalPages,
                currentPage: pageNumber,
                pageSize
            }
        });
    } catch (error) {
        console.error("Get LinkedIn Posts Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};