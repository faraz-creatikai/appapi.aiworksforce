import cron from 'node-cron';
import prisma from '../config/prismaClient.js';
// IMPORTANT: Update this path to wherever your Prisma client is exported


export const initInstagramCron = () => {
    console.log("Instagram Cron Job Initialized: Checking for scheduled posts every minute...");

    // Run this job every minute
    cron.schedule('* * * * *', async () => {
        const now = new Date();

        try {
            // 1. Find posts that are due to be published
            const duePosts = await prisma.scheduledPost.findMany({
                where: {
                    status: "SCHEDULED",
                    platform: "INSTAGRAM",
                    scheduledTime: { lte: now } // Time is now or in the past
                }
            });

            if (duePosts.length > 0) {
                 console.log(`Found ${duePosts.length} post(s) ready to publish.`);
            }

            for (const post of duePosts) {
                // Retrieve the user's access token from the socialAccount table
                const account = await prisma.socialAccount.findFirst({
                    where: { userId: post.userId, platform: "INSTAGRAM" }
                });

                if (!account) continue;

                // 2. Create the media container (NO scheduled_publish_time)
                const createRes = await fetch(
                    `https://graph.facebook.com/v19.0/${post.igAccountId}/media`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            image_url: post.imageUrl,
                            caption: post.caption,
                            access_token: account.accessToken,
                        }),
                    }
                );
                const createData = await createRes.json();

                if (!createData.id) {
                    console.error(`[Post ID: ${post.id}] Failed to create container:`, createData);
                    await prisma.scheduledPost.update({
                        where: { id: post.id },
                        data: { status: "FAILED" }
                    });
                    continue;
                }

                // 3. Publish the container immediately
                const publishRes = await fetch(
                    `https://graph.facebook.com/v19.0/${post.igAccountId}/media_publish`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            creation_id: createData.id,
                            access_token: account.accessToken,
                        }),
                    }
                );
                const publishData = await publishRes.json();

                // 4. Update the database to reflect the successful post
                if (publishData.id) {
                    console.log(`[Post ID: ${post.id}] Successfully published to Instagram!`);
                    await prisma.scheduledPost.update({
                        where: { id: post.id },
                        data: { 
                            status: "PUBLISHED",
                            containerId: createData.id,
                            scheduledId: publishData.id
                        }
                    });
                }
            }
        } catch (error) {
            console.error("Cron Job Error:", error);
        }
    });
};


export const initFacebookCron = () => {
    console.log("Facebook Cron Job Initialized: Checking for scheduled posts every minute...");

    // Run this job every minute
    cron.schedule('* * * * *', async () => {
        const now = new Date();

        try {
            // 1. Find posts that are due to be published
            const duePosts = await prisma.scheduledPost.findMany({
                where: {
                    status: "SCHEDULED",
                    platform: "FACEBOOK",
                    scheduledTime: { lte: now } // Time is now or in the past
                }
            });

            if (duePosts.length > 0) {
                 console.log(`Found ${duePosts.length} Facebook post(s) ready to publish.`);
            }

            for (const post of duePosts) {
                // Retrieve the user's access token from the socialAccount table
                // NOTE: Make sure this uses post.adminId to match your schema!
                const account = await prisma.socialAccount.findFirst({
                    where: { userId: post.adminId, platform: "FACEBOOK" } 
                });

                if (!account) continue;

                // 2. Publish directly to Facebook (One Step!)
                // post.igAccountId actually holds the Facebook Page ID here based on how we saved it
                const publishRes = await fetch(
                    `https://graph.facebook.com/v19.0/${post.igAccountId}/photos`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            url: post.imageUrl,        // Facebook uses 'url'
                            message: post.caption,     // Facebook uses 'message'
                            access_token: account.accessToken,
                        }),
                    }
                );
                
                const publishData = await publishRes.json();

                // 3. Handle Failure
                if (!publishData.id) {
                    console.error(`[Post ID: ${post.id}] Failed to publish to Facebook:`, publishData);
                    await prisma.scheduledPost.update({
                        where: { id: post.id },
                        data: { status: "FAILED" }
                    });
                    continue;
                }

                // 4. Update the database to reflect the successful post
                console.log(`[Post ID: ${post.id}] Successfully published to Facebook!`);
                await prisma.scheduledPost.update({
                    where: { id: post.id },
                    data: { 
                        status: "PUBLISHED",
                        scheduledId: publishData.id // The ID Meta returns for the live post
                    }
                });
            }
        } catch (error) {
            console.error("Facebook Cron Job Error:", error);
        }
    });
};