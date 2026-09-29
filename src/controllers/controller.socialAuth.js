import { SocialContentAgent } from "../ai/agent.js";
import cloudinary from "../config/cloudinary.js";
import { clientUrl } from "../config/cors-origins.js";
import prisma from "../config/prismaClient.js";
import fs from "fs";


//Cache to store analytics data for 10 minutes to reduce API calls
const analyticsCache = new Map();

//Cache to store scheduled posts data for 10 minutes
const postCache = new Map();

//Universal cache time (in minutes)
const CACHE_TTL_MINUTES = 5;

// Convert once → reuse everywhere
const CACHE_TTL = CACHE_TTL_MINUTES * 60 * 1000;


//old working for instagram only (without facebook token saving and without scheduling)
/* export const metaCallback = async (req, res) => {
    try {
        const code = req.query.code;

        if (!code) {
            return res.status(400).send("No code received");
        }

        // =========================
        // 1. Exchange code → short-lived token
        // =========================
        const tokenRes = await fetch(
            `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.FB_APP_ID}&client_secret=${process.env.FB_APP_SECRET}&redirect_uri=${process.env.REDIRECT_URI}&code=${code}`
        );

        const tokenData = await tokenRes.json();

        if (!tokenData.access_token) {
            console.error("Short token error:", tokenData);
            return res.status(400).json({
                error: "Failed to get short-lived token",
                details: tokenData,
            });
        }

        // =========================
        // 2. Exchange → long-lived token
        // =========================
        const longRes = await fetch(
            `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.FB_APP_ID}&client_secret=${process.env.FB_APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
        );

        const longData = await longRes.json();

        if (!longData.access_token) {
            console.error("Long token error:", longData);
            return res.status(400).json({
                error: "Failed to get long-lived token",
                details: longData,
            });
        }

        const accessToken = longData.access_token;

        console.log("✅ Access Token received", accessToken);

        // =========================
        // 3. Get all Facebook Pages
        // =========================
        const pagesRes = await fetch(
            `https://graph.facebook.com/v19.0/me/accounts?access_token=${accessToken}`
        );

        const pagesData = await pagesRes.json();

        if (!pagesData.data || pagesData.data.length === 0) {
            return res.status(400).json({
                error: "No Facebook pages found",
                hint: "Check permissions or page roles",
                raw: pagesData,
            });
        }

        console.log(
            "📄 Pages found:",
            pagesData.data.map((p) => ({ id: p.id, name: p.name }))
        );

        // =========================
        // 4. OPTIONAL: If user selects page manually
        // =========================
        const requestedPageId = req.query.pageId;

        let selectedPage = null;
        let igAccountId = null;
        let facebookPageToken = null;

        // =========================
        // 5. If pageId provided → use it
        // =========================
        if (requestedPageId) {
            console.log("🎯 Using user-selected page:", requestedPageId);

            const igRes = await fetch(
                `https://graph.facebook.com/v19.0/${requestedPageId}?fields=instagram_business_account&access_token=${accessToken}`
            );

            const igData = await igRes.json();

            if (!igData.instagram_business_account?.id) {
                return res.status(400).json({
                    error: "Selected page has no Instagram linked",
                    igData,
                });
            }

            selectedPage = requestedPageId;
            igAccountId = igData.instagram_business_account.id;
        } else {
            // =========================
            // 6. AUTO-DETECT page with IG
            // =========================
            console.log("🔍 Auto-detecting Instagram-linked page...");

            for (const page of pagesData.data) {
                const igRes = await fetch(
                    `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${accessToken}`
                );

                const igData = await igRes.json();

                console.log(`Checking page: ${page.name}`, igData);

                if (igData.instagram_business_account?.id) {
                    selectedPage = page.id;
                    igAccountId = igData.instagram_business_account.id;
                    break;
                }
            }

            // ❌ No IG found on any page
            if (!igAccountId) {
                return res.status(400).json({
                    error: "No Instagram business account linked to any page",
                    suggestion: "Let user pick page manually",
                    pages: pagesData.data.map((p) => ({
                        id: p.id,
                        name: p.name,
                    })),
                });
            }
        }

        console.log("✅ Selected Page:", selectedPage);
        console.log("📸 IG Account ID:", igAccountId);

        // =========================
        // 7. Save in DB
        // =========================
        await prisma.socialAccount.upsert({
            where: {
                userId_platform: {
                    userId: req.admin.id,
                    platform: "INSTAGRAM",
                },
            },
            update: {
                accessToken,
                igAccountId,
                pageId: selectedPage,
            },
            create: {
                userId: req.admin.id,
                platform: "INSTAGRAM",
                accessToken,
                igAccountId,
                pageId: selectedPage,
            },
        });

        console.log("💾 Saved to DB");

        // =========================
        // 8. Redirect to frontend
        // =========================
        res.redirect("http://localhost:3000/socialmedia-manager");
    } catch (err) {
        console.error("❌ OAuth Error:", err);
        res.status(500).json({
            error: "OAuth failed",
            details: err.message,
        });
    }
}; */


// NEW: Updated metaCallback to also save Facebook Page token and handle scheduling
export const metaCallback = async (req, res) => {
    try {
        const code = req.query.code;

        if (!code) {
            return res.status(400).send("No code received");
        }

        // =========================
        // 1. Exchange code → short-lived token
        // =========================
        const tokenRes = await fetch(
            `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.FB_APP_ID}&client_secret=${process.env.FB_APP_SECRET}&redirect_uri=${process.env.REDIRECT_URI}&code=${code}`
        );
        const tokenData = await tokenRes.json();

        if (!tokenData.access_token) {
            console.error("Short token error:", tokenData);
            return res.status(400).json({ error: "Failed to get short-lived token", details: tokenData });
        }

        // =========================
        // 2. Exchange → long-lived token
        // =========================
        const longRes = await fetch(
            `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.FB_APP_ID}&client_secret=${process.env.FB_APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
        );
        const longData = await longRes.json();

        if (!longData.access_token) {
            console.error("Long token error:", longData);
            return res.status(400).json({ error: "Failed to get long-lived token", details: longData });
        }

        const accessToken = longData.access_token;
        console.log("✅ Access Token received", accessToken);

        // =========================
        // 3. Get all Facebook Pages
        // =========================
        const pagesRes = await fetch(
            `https://graph.facebook.com/v19.0/me/accounts?access_token=${accessToken}`
        );
        const pagesData = await pagesRes.json();

        if (!pagesData.data || pagesData.data.length === 0) {
            return res.status(400).json({ error: "No Facebook pages found", hint: "Check permissions or page roles", raw: pagesData });
        }

        console.log("📄 Pages found:", pagesData.data.map((p) => ({ id: p.id, name: p.name })));

        // =========================
        // 4. Variables to hold our IDs and Tokens
        // =========================
        const requestedPageId = req.query.pageId;

        let selectedPage = null;
        let igAccountId = null;
        let facebookPageToken = null; // 🟢 NEW: Variable to hold the Facebook Page Token

        // =========================
        // 5. If pageId provided → use it
        // =========================
        if (requestedPageId) {
            console.log("🎯 Using user-selected page:", requestedPageId);

            const igRes = await fetch(
                `https://graph.facebook.com/v19.0/${requestedPageId}?fields=instagram_business_account&access_token=${accessToken}`
            );
            const igData = await igRes.json();

            if (!igData.instagram_business_account?.id) {
                return res.status(400).json({ error: "Selected page has no Instagram linked", igData });
            }

            selectedPage = requestedPageId;
            igAccountId = igData.instagram_business_account.id;

            // 🟢 NEW: Find the matching page from step 3 and grab its specific access token
            const matchedPage = pagesData.data.find(p => p.id === requestedPageId);
            if (matchedPage) {
                facebookPageToken = matchedPage.access_token;
            }

        } else {
            // =========================
            // 6. AUTO-DETECT page with IG
            // =========================
            console.log("🔍 Auto-detecting Instagram-linked page...");

            for (const page of pagesData.data) {
                const igRes = await fetch(
                    `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${accessToken}`
                );
                const igData = await igRes.json();
                console.log(`Checking page: ${page.name}`, igData);

                if (igData.instagram_business_account?.id) {
                    selectedPage = page.id;
                    igAccountId = igData.instagram_business_account.id;
                    facebookPageToken = page.access_token; // 🟢 NEW: Grab the token from this specific page
                    break;
                }
            }

            if (!igAccountId) {
                return res.status(400).json({
                    error: "No Instagram business account linked to any page",
                    suggestion: "Let user pick page manually",
                    pages: pagesData.data.map((p) => ({ id: p.id, name: p.name })),
                });
            }
        }

        console.log("✅ Selected Page:", selectedPage);
        console.log("📸 IG Account ID:", igAccountId);

        // =========================
        // 7. Save to DB (🟢 NEW: Saves both IG and FB)
        // =========================

        // Save INSTAGRAM configuration
        await prisma.socialAccount.upsert({
            where: {
                userId_platform: {
                    userId: req.admin.id,
                    platform: "INSTAGRAM",
                },
            },
            update: {
                accessToken: accessToken, // IG uses the main user access token
                igAccountId,
                pageId: selectedPage,
            },
            create: {
                userId: req.admin.id,
                platform: "INSTAGRAM",
                accessToken: accessToken,
                igAccountId,
                pageId: selectedPage,
            },
        });


        // 🟢 NEW: Save FACEBOOK configuration
        if (facebookPageToken) {
            await prisma.socialAccount.upsert({
                where: {
                    userId_platform: {
                        userId: req.admin.id,
                        platform: "FACEBOOK",
                    },
                },
                update: {
                    accessToken: facebookPageToken,
                    pageId: selectedPage,
                    igAccountId: igAccountId, // FIX: Added this to satisfy Prisma
                },
                create: {
                    userId: req.admin.id,
                    platform: "FACEBOOK",
                    accessToken: facebookPageToken,
                    pageId: selectedPage,
                    igAccountId: igAccountId, // FIX: Added this to satisfy Prisma
                },
            });
        }
        console.log("💾 Saved both IG and FB to DB");

        // =========================
        // 8. Redirect to frontend
        // =========================
        res.redirect(`${clientUrl}/socialmedia-manager`);
    } catch (err) {
        console.error("❌ OAuth Error:", err);
        res.status(500).json({
            error: "OAuth failed",
            details: err.message,
        });
    }
};

export const getInstagramLivePosts = async (req, res) => {
    try {
        const userId = req.admin.id;

        const cacheKey = `ig_live_posts_${userId}`;

        // CHECK CACHE (5 min)
        const cached = postCache.get(cacheKey);
       /*  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return res.json({
                success: true,
                posts: cached.data,
                cached: true
            });
        } */

        // 1. Get connected account
        const account = await prisma.socialAccount.findFirst({
            where: {
                userId,
                platform: "INSTAGRAM",
            },
        });

        if (!account) {
            return res.status(400).send("Instagram not connected");
        }

        const { igAccountId, accessToken } = account;

        // 2. Fetch posts from Instagram
        const response = await fetch(
            `https://graph.facebook.com/v19.0/${igAccountId}/media?fields=id,caption,media_type,media_url,thumbnail_url,timestamp,permalink&access_token=${accessToken}`
        );

        const data = await response.json();

        console.log(" data is ", data)

        if (!data.data) {
            return res.status(400).send("No posts found");
        }

        postCache.set(cacheKey, {
            data: data.data,
            timestamp: Date.now(),
        });

        res.json({
            success: true,
            posts: data.data,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to fetch posts");
    }
};

export const getInstagramAnalytics = async (req, res) => {
    try {
        const adminId = req.admin.id;

        const cacheKey = `ig_analytics_${adminId}`;

        // ✅ RETURN CACHE (10 min)
        const cached = analyticsCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return res.json({
                success: true,
                analytics: cached.data,
                cached: true
            });
        }

        const account = await prisma.socialAccount.findFirst({
            where: { userId: adminId, platform: "INSTAGRAM" },
        });

        if (!account) {
            return res.status(400).json({
                success: false,
                error: "Instagram not connected",
            });
        }

        const { igAccountId, accessToken } = account;

        // ✅ 1. Reach (time-based metric)
        const reachRes = await fetch(
            `https://graph.facebook.com/v19.0/${igAccountId}/insights?metric=reach&period=day&access_token=${accessToken}`
        );
        const reachData = await reachRes.json();

        // ✅ 2. Profile + Engagement (total metrics)
        const totalRes = await fetch(
            `https://graph.facebook.com/v19.0/${igAccountId}/insights?metric=profile_views,accounts_engaged&period=day&metric_type=total_value&access_token=${accessToken}`
        );
        const totalData = await totalRes.json();

        // ✅ 3. Followers (CORRECT endpoint)
        const followerRes = await fetch(
            `https://graph.facebook.com/v19.0/${igAccountId}?fields=followers_count&access_token=${accessToken}`
        );
        const followerData = await followerRes.json();

        // ❌ error handling
        if (reachData.error || totalData.error || followerData.error) {
            return res.status(400).json({
                success: false,
                error:
                    reachData.error?.message ||
                    totalData.error?.message ||
                    followerData.error?.message,
            });
        }

        // ✅ extract values cleanly
        const getValue = (data, key) => {
            const metric = data?.data?.find((m) => m.name === key);
            return (
                metric?.values?.[0]?.value ??
                metric?.total_value?.value ??
                0
            );
        };

        const analytics = {
            reach: getValue(reachData, "reach"),
            profile_views: getValue(totalData, "profile_views"),
            accounts_engaged: getValue(totalData, "accounts_engaged"),
            follower_count: followerData.followers_count || 0,
        };


        // SAVE CACHE
        analyticsCache.set(cacheKey, {
            data: analytics,
            timestamp: Date.now(),
        });

        return res.json({
            success: true,
            analytics,
        });

    } catch (err) {
        console.error("Instagram Analytics Error:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to fetch Instagram analytics",
        });
    }
};


export const publishPost = async (req, res) => {
    try {
        const { imageUrl, caption } = req.body;

        const userId = req.admin.id; // same auth system you used

        const cacheKey = `ig_publish_${userId}`;
        const cached = postCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return res.json({ success: true, posts: cached.data, cached: true });
        }

        // 1. Get saved IG account
        const account = await prisma.socialAccount.findFirst({
            where: {
                userId,
                platform: "INSTAGRAM",
            },
        });

        if (!account) {
            return res.status(400).send("Instagram not connected");
        }

        const { accessToken, igAccountId } = account;

        // 2. Create media container
        const createRes = await fetch(
            `https://graph.facebook.com/v19.0/${igAccountId}/media`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    image_url: imageUrl,
                    caption,
                    access_token: accessToken,
                }),
            }
        );

        const createData = await createRes.json();

        if (!createData.id) {
            return res.status(400).send(createData);
        }

        // 3. Publish
        const publishRes = await fetch(
            `https://graph.facebook.com/v19.0/${igAccountId}/media_publish`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    creation_id: createData.id,
                    access_token: accessToken,
                }),
            }
        );

        const publishData = await publishRes.json();
        postCache.set(cacheKey, { timestamp: Date.now(), data: publishData });

        if (!publishData.id) {
            return res.status(400).send(publishData);
        }

        res.json({
            success: true,
            postId: publishData.id,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Post failed");
    }
};

export const publishFacebookPost = async (req, res) => {
    try {
        const { imageUrl, caption } = req.body;
        const adminId = req.admin.id;

        // 1. Get saved FACEBOOK account
        const account = await prisma.socialAccount.findFirst({
            where: {
                userId: adminId,
                platform: "FACEBOOK",
            },
        });

        if (!account) {
            return res.status(400).send("Facebook not connected");
        }

        const { accessToken, pageId } = account;

        // 2. Publish directly to the Page's Photos endpoint
        // For text-only posts, you would use /feed instead of /photos
        const fbRes = await fetch(
            `https://graph.facebook.com/v19.0/${pageId}/photos`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: imageUrl,     // Facebook uses 'url' instead of 'image_url'
                    message: caption,  // Facebook uses 'message' instead of 'caption'
                    access_token: accessToken,
                }),
            }
        );

        const fbData = await fbRes.json();

        if (fbData.error) {
            console.error("Facebook API Error:", fbData.error);
            return res.status(400).json({ error: "Failed to post to Facebook", details: fbData });
        }

        res.json({
            success: true,
            postId: fbData.id,
            message: "Posted to Facebook successfully"
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Facebook Post failed");
    }
};



export const scheduleInstagramPost = async (req, res) => {
    try {
        const { caption, scheduledTime } = req.body;

        // Changed variable name to adminId to match your schema
        const adminId = req.admin.id;

        // 1. Validation: Meta requires > 20 mins and < 75 days
        const publishTimeUnix = Math.floor(new Date(scheduledTime).getTime() / 1000);
        const nowUnix = Math.floor(Date.now() / 1000);

        if (publishTimeUnix < nowUnix + (1 * 60)) {
            return res.status(400).json({ error: "Schedule time must be at least 10 minutes in the future." });
        }

        // 2. Get saved IG account
        // Note: Assuming your SocialAccount model uses "userId". If it also uses "adminId", change the key below to adminId: adminId
        const account = await prisma.socialAccount.findFirst({
            where: { userId: adminId, platform: "INSTAGRAM" },
        });

        if (!account) return res.status(400).send("Instagram not connected");

        let PostImages = [];

        if (req.files?.PostImage) {
            const uploads = req.files.PostImage.map((file) =>
                cloudinary.uploader
                    .upload(file.path, {
                        folder: "instagram/instagram_images",
                        transformation: [{ width: 1000, crop: "limit" }],
                    })
                    .then((upload) => {
                        fs.unlinkSync(file.path);
                        return upload.secure_url;
                    })
            );
            PostImages = await Promise.all(uploads);
        }

        // FIX: Do not use JSON.stringify(PostImages). 
        // If you stringify an array, imageUrl[0] becomes "[" which breaks the Meta API.
        const imageUrl = PostImages[0];

        // 3. SAVE TO PRISMA DB AS "SCHEDULED"
        const savedPost = await prisma.scheduledPost.create({
            data: {
                adminId: adminId,  // <--- FIX: This now matches your schema
                imageUrl: imageUrl,
                caption: caption,
                igAccountId: account.igAccountId,
                scheduledTime: new Date(scheduledTime),
                status: "SCHEDULED",
                platform: "INSTAGRAM"
                // containerId and scheduledId are left null for now
            }
        });

        res.json({
            success: true,
            message: "Post scheduled in database successfully",
            post: savedPost
        });

    } catch (err) {
        console.error("Schedule Error:", err);
        res.status(500).send("Scheduling failed");
    }
};

export const getScheduledPosts = async (req, res) => {
    try {
        const adminId = req.admin.id;
        const targetPlatform = req.query.platform; // e.g., ?platform=FACEBOOK

        const whereClause = {
            adminId,
            status: "SCHEDULED",
        };

        // If the frontend requests a specific platform, add it to the filter
        if (targetPlatform) {
            whereClause.platform = targetPlatform;
        }

        const posts = await prisma.scheduledPost.findMany({
            where: whereClause,
            orderBy: {
                scheduledTime: 'asc'
            }
        });

        if (!posts || posts.length === 0) {
            return res.status(404).json({ success: false, message: "No scheduled posts found" });
        }

        res.json({ success: true, posts });
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to fetch scheduled posts from database");
    }
};

/* export const getScheduledPosts = async (req, res) => {
    try {
        const userId = req.admin.id;
        const account = await prisma.socialAccount.findFirst({
            where: { userId, platform: "INSTAGRAM" },
        });

        const response = await fetch(
            `https://graph.facebook.com/v19.0/${account.igAccountId}/scheduled_posts?fields=id,caption,media_type,media_url,scheduled_publish_time&access_token=${account.accessToken}`
        );

        const data = await response.json();
        res.json({ success: true, posts: data.data || [] });
    } catch (err) {
        res.status(500).send("Failed to fetch scheduled posts");
    }
}; */

export const disconnectInstagram = async (req, res) => {
    try {
        const userId = req.admin.id;

        // 1. Find account (optional but cleaner)
        const account = await prisma.socialAccount.findFirst({
            where: {
                userId,
                platform: "INSTAGRAM",
            },
        });

        if (!account) {
            return res.status(400).json({
                success: false,
                message: "Instagram not connected",
            });
        }


        //optional revoke permission from meta
        /*         const { accessToken } = account;
        
                await fetch(
                    `https://graph.facebook.com/me/permissions?access_token=${accessToken}`,
                    {
                        method: "DELETE",
                    }
                ); */

        // 2. Delete from DB (THIS is the real disconnect)
        await prisma.socialAccount.delete({
            where: {
                userId_platform: {
                    userId,
                    platform: "INSTAGRAM",
                },
            },
        });

        // Clear caches
        postCache.delete(`ig_live_posts_${userId}`);
        postCache.delete(`ig_publish_${userId}`);
        analyticsCache.delete(`ig_analytics_${userId}`);

        res.json({
            success: true,
            message: "Instagram disconnected successfully",
        });
    } catch (err) {
        console.error("Disconnect Error:", err);
        res.status(500).json({
            success: false,
            message: "Failed to disconnect Instagram",
        });
    }
};


//facebook 

export const getFacebookLivePosts = async (req, res) => {
    try {
        const adminId = req.admin.id;

        const cacheKey = `fb_live_posts_${adminId}`;

        //CHECK CACHE (5 min)
        /* const cached = postCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return res.json({
                success: true,
                posts: cached.data,
                cached: true
            });
        } */

        // 1. Get connected Facebook account
        const account = await prisma.socialAccount.findFirst({
            where: {
                userId: adminId,
                platform: "FACEBOOK",
            },
        });

        if (!account) {
            return res.status(400).send("Facebook not connected");
        }

        const { pageId, accessToken } = account;

        // 2. Fetch posts from Facebook Page
        const response = await fetch(
            `https://graph.facebook.com/v19.0/${pageId}/published_posts?fields=id,message,created_time,full_picture,permalink_url&access_token=${accessToken}`
        );

        const data = await response.json();

        console.log("Facebook data is ", data);

        if (!data.data) {
            return res.status(400).send("No posts found");
        }

        const normalizedPosts = data.data.map(post => ({
            id: post.id,
            caption: post.message || "",               // match IG
            media_type: post.full_picture ? "IMAGE" : "TEXT", // basic mapping
            media_url: post.full_picture || null,      // match IG
            thumbnail_url: post.full_picture || null,  // optional
            timestamp: post.created_time,              // match IG
            permalink: post.permalink_url,             // match IG
        }));

        //SAVE CACHE
        postCache.set(cacheKey, {
            data: normalizedPosts,
            timestamp: Date.now(),
        });

        res.json({
            success: true,
            posts: normalizedPosts,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to fetch Facebook posts");
    }
};

export const getFacebookAnalytics = async (req, res) => {
    try {

        const adminId = req.admin.id;

        // 🔥 CACHE KEY
        const cacheKey = `fb_analytics_${adminId}`;

        // ✅ 1. RETURN CACHE if exists (10 min TTL)
        const cached = analyticsCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return res.json({
                success: true,
                analytics: cached.data,
                cached: true
            });
        }

        const account = await prisma.socialAccount.findFirst({
            where: { userId: req.admin.id, platform: "FACEBOOK" },
        });

        if (!account) {
            return res.status(400).json({
                success: false,
                error: "Facebook not connected",
            });
        }

        const { pageId, accessToken } = account;

        // ✅ helper function (single metric fetch)
        const fetchMetric = async (metric) => {
            const url = `https://graph.facebook.com/v19.0/${pageId}/insights?metric=${metric}&period=day&access_token=${accessToken}`;

            const res = await fetch(url);
            const data = await res.json();

            if (data.error) {
                console.log(`❌ Metric failed: ${metric}`, data.error.message);
                return 0; // DON'T BREAK API
            }

            return data?.data?.[0]?.values?.[0]?.value || 0;
        };
        console.log(" facebook metric ", fetchMetric)
        // ✅ fetch metrics SAFELY (no crash)
        const impressions = await fetchMetric("page_impressions");
        const reach = await fetchMetric("page_reach");
        const engagement = await fetchMetric("page_engaged_users");

        console.log("Fetched Metrics:", { impressions, reach, engagement });
        // ✅ followers (separate endpoint)
        const followersRes = await fetch(
            `https://graph.facebook.com/v19.0/${pageId}?fields=followers_count&access_token=${accessToken}`
        );

        const followersData = await followersRes.json();

        console.log("Fetched Followers:", followersData.followers_count);

        const analytics = {
            impressions,
            reach,
            accounts_engaged: engagement,
            follower_count: followersData.followers_count || 0,
        };

        // ✅ 2. SAVE CACHE
        analyticsCache.set(cacheKey, {
            data: analytics,
            timestamp: Date.now(),
        });

        return res.json({
            success: true,
            analytics: analytics,
        });

    } catch (err) {
        console.error("Facebook Analytics Error:", err);

        return res.status(500).json({
            success: false,
            error: "Failed to fetch Facebook analytics",
        });
    }
};


//schedule 

export const scheduleFacebookPost = async (req, res) => {
    try {
        const { caption, scheduledTime } = req.body;
        const adminId = req.admin.id;

        // 1. Validation
        const publishTimeUnix = Math.floor(new Date(scheduledTime).getTime() / 1000);
        const nowUnix = Math.floor(Date.now() / 1000);

        if (publishTimeUnix < nowUnix + (1 * 60)) {
            return res.status(400).json({ error: "Schedule time must be at least 20 minutes in the future." });
        }

        // 2. Get saved FB account
        const account = await prisma.socialAccount.findFirst({
            where: { userId: adminId, platform: "FACEBOOK" },
        });

        if (!account) return res.status(400).send("Facebook not connected");

        let PostImages = [];

        if (req.files?.PostImage) {
            const uploads = req.files.PostImage.map((file) =>
                cloudinary.uploader
                    .upload(file.path, {
                        folder: "facebook/facebook_images",
                        transformation: [{ width: 1000, crop: "limit" }],
                    })
                    .then((upload) => {
                        fs.unlinkSync(file.path);
                        return upload.secure_url;
                    })
            );
            PostImages = await Promise.all(uploads);
        }

        const imageUrl = PostImages.length > 0 ? PostImages[0] : "";

        // 3. SAVE TO PRISMA DB AS "SCHEDULED"
        const savedPost = await prisma.scheduledPost.create({
            data: {
                adminId: adminId,
                imageUrl: imageUrl,
                caption: caption,
                igAccountId: account.pageId, // Saving the Page ID here for the cron job to use
                scheduledTime: new Date(scheduledTime),
                status: "SCHEDULED",
                platform: "FACEBOOK" // Distinguishes it for the cron job
            }
        });

        res.json({
            success: true,
            message: "Facebook Post scheduled in database successfully",
            post: savedPost
        });

    } catch (err) {
        console.error("Schedule Error:", err);
        res.status(500).send("Scheduling failed");
    }
};

export const disconnectFacebook = async (req, res) => {
    try {
        const adminId = req.admin.id;

        // 1. Find account to ensure it exists
        const account = await prisma.socialAccount.findFirst({
            where: {
                userId: adminId,
                platform: "FACEBOOK",
            },
        });

        if (!account) {
            return res.status(400).json({
                success: false,
                message: "Facebook not connected",
            });
        }

        // 2. Delete from DB
        await prisma.socialAccount.delete({
            where: {
                userId_platform: {
                    userId: adminId,
                    platform: "FACEBOOK",
                },
            },
        });

        //clear cache
        postCache.delete(`fb_live_posts_${userId}`);
        analyticsCache.delete(`fb_analytics_${userId}`);

        res.json({
            success: true,
            message: "Facebook disconnected successfully",
        });
    } catch (err) {
        console.error("Disconnect Error:", err);
        res.status(500).json({
            success: false,
            message: "Failed to disconnect Facebook",
        });
    }
};

const connectInstagram = (userId) => {
    const clientId = process.env.NEXT_PUBLIC_FB_APP_ID;
    const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;

    const url =
        `https://www.facebook.com/v19.0/dialog/oauth` +
        `?client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=pages_show_list,instagram_basic,instagram_content_publish` +
        `&response_type=code` +
        `&state=${userId}`;

    window.location.href = url;
};



// ─────────────────────────────────────────────────────────────
// Provider 1 — HuggingFace Inference API  (FREE, no usage cap)
// Model: FLUX.1-schnell — fast, high quality, genuinely free
// Requires HUGGINGFACE_API_KEY in .env  (free account is enough)
// ─────────────────────────────────────────────────────────────
const generateWithHuggingFace = async (prompt) => {
    const res = await fetch(
        "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell", // ← correct
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                "Content-Type": "application/json",
                "x-wait-for-model": "true",
            },
            body: JSON.stringify({
                inputs: prompt,
                parameters: { width: 1024, height: 1024 },
            }),
        }
    );

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HuggingFace ${res.status}: ${text.slice(0, 120)}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
};

//run auto social agent with ai generated image and caption without manual file upload
export const runAutoSocialAgent = async (req, res) => {
    try {
        const { content, platform, scheduledTime } = req.body; // e.g., { "userGoal": "Post about coffee", "platform": "INSTAGRAM" }
        const adminId = req.admin.id;

        // 1. Ask Gemini to "Reason" and create the post details
        const aipayload = {
            userGoal: content,
            platform,
            scheduledTime
        };
        const aiPost = await SocialContentAgent(aipayload);

        // 2. Generate Image & Upload directly to Cloudinary
        // Using Pollinations.ai as a free "no-key" image generator
        // Inside runAutoSocialAgent...

        // 1. Generate the Image URL from the AI
        // Use 'image.pollinations.ai/prompt/' or 'gen.pollinations.ai/image/'
        console.log("AI Post Data:", aiPost.imagePrompt, " more data ", aiPost); // Check what the AI returned in your console

        let imageUrl = "";

        // 1. If user uploaded image → upload that
        if (req.files?.PostImage && req.files.PostImage.length > 0) {
            const uploads = req.files.PostImage.map((file) =>
                cloudinary.uploader
                    .upload(file.path, {
                        folder:
                            platform === "FACEBOOK"
                                ? "facebook/facebook_images"
                                : "instagram/instagram_images",
                        transformation: [{ width: 1000, crop: "limit" }],
                    })
                    .then((upload) => {
                        fs.unlinkSync(file.path);
                        return upload.secure_url;
                    })
            );

            const PostImages = await Promise.all(uploads);
            imageUrl = PostImages[0]; // take first image
        }

        //2. Else → fallback to AI image generation
else {
    const imageBuffer = await generateWithHuggingFace(aiPost.imagePrompt);

    const folder = platform === "FACEBOOK"
        ? "facebook/facebook_images"
        : "instagram/instagram_images";

    // upload_stream because we have a Buffer, not a file path or URL
    imageUrl = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
            { folder, transformation: [{ width: 1000, crop: "limit" }] },
            (error, result) => {
                if (error) return reject(error);
                resolve(result.secure_url);
            }
        ).end(imageBuffer); // .end() pushes the Buffer into the stream
    });
}



        // 3. Get Account details (reusing your logic)
        const account = await prisma.socialAccount.findFirst({
            where: { userId: adminId, platform: platform.toUpperCase() },
        });

        if (!account) return res.status(400).send(`${platform} account not connected`);

        // 4. Save to your existing Prisma table
        const savedPost = await prisma.scheduledPost.create({
            data: {
                adminId: adminId,
                imageUrl: imageUrl,
                caption: aiPost.caption,
                igAccountId: platform === "INSTAGRAM" ? account.igAccountId : account.pageId,
                scheduledTime: new Date(aiPost.scheduledTime),
                status: "SCHEDULED",
                platform: platform.toUpperCase()
            }
        });

        res.json({
            success: true,
            agentSummary: aiPost.contentSummary ? aiPost.contentSummary : "AI Agent successfully generated image and scheduled post.",
            scheduledTime,
            post: savedPost
        });

    } catch (err) {
        console.error("Agent Error:", err);
        res.status(500).json({ error: "Agent failed to process request" });
    }
};

//old ai image genreration controller without menual file upload

/* export const runAutoSocialAgent = async (req, res) => {
    try {
        const { content, platform, scheduledTime } = req.body; // e.g., { "userGoal": "Post about coffee", "platform": "INSTAGRAM" }
        const adminId = req.admin.id;

        // 1. Ask Gemini to "Reason" and create the post details
        const aipayload = {
            userGoal: content,
            platform,
            scheduledTime
        };
        const aiPost = await SocialContentAgent(aipayload);

        // 2. Generate Image & Upload directly to Cloudinary
        // Using Pollinations.ai as a free "no-key" image generator
        // Inside runAutoSocialAgent...

        // 1. Generate the Image URL from the AI
        // Use 'image.pollinations.ai/prompt/' or 'gen.pollinations.ai/image/'
        console.log("AI Post Data:", aiPost.imagePrompt, " more data ", aiPost); // Check what the AI returned in your console

        const generatedImageUrl =
            "https://image.pollinations.ai/prompt/" +
            encodeURIComponent(aiPost.imagePrompt) +
            "?width=1080&height=1080&nologo=true";


        console.log("Generated Image URL:", generatedImageUrl); // Verify this in your console!




        // 2. Modified Cloudinary Upload (Replacing your req.files block)
        // We pass the URL directly. Cloudinary fetches and hosts it.
        const upload = await cloudinary.uploader.upload(generatedImageUrl, {
            // Dynamic folder based on your platform logic
            folder: platform === "FACEBOOK" ? "facebook/facebook_images" : "instagram/instagram_images",
            transformation: [{ width: 1000, crop: "limit" }],
            timeout: 120000, // <--- Add this (120 seconds) to prevent the timeout error
        });

        // 3. The resulting URL for Prisma
        const imageUrl = upload.secure_url;

        // No fs.unlinkSync needed here because the file never touched your local disk!


        // 3. Get Account details (reusing your logic)
        const account = await prisma.socialAccount.findFirst({
            where: { userId: adminId, platform: platform.toUpperCase() },
        });

        if (!account) return res.status(400).send(`${platform} account not connected`);

        // 4. Save to your existing Prisma table
        const savedPost = await prisma.scheduledPost.create({
            data: {
                adminId: adminId,
                imageUrl: imageUrl,
                caption: aiPost.caption,
                igAccountId: platform === "INSTAGRAM" ? account.igAccountId : account.pageId,
                scheduledTime: new Date(aiPost.scheduledTime),
                status: "SCHEDULED",
                platform: platform.toUpperCase()
            }
        });

        res.json({
            success: true,
            agentSummary: aiPost.contentSummary ? aiPost.contentSummary : "AI Agent successfully generated image and scheduled post.",
            scheduledTime,
            post: savedPost
        });

    } catch (err) {
        console.error("Agent Error:", err);
        res.status(500).json({ error: "Agent failed to process request" });
    }
}; */





