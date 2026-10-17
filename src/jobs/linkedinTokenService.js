import prisma from "../config/prismaClient.js";


/**
 * Ensures the admin has a valid LinkedIn access token.
 * If the current token is expired, it uses the refresh token to fetch a new one.
 */
export const getValidLinkedInToken = async (adminId) => {
    const account = await prisma.linkedinAccount.findUnique({
        where: { adminId: adminId }
    });

    if (!account) {
        throw new Error("No LinkedIn account connected.");
    }

    const now = new Date();
    
    // If the token is still valid (adding a 5-minute buffer), return it immediately
    if (account.accessTokenExpiresAt > new Date(now.getTime() + 5 * 60000)) {
        return {
            accessToken: account.accessToken,
            personUrn: account.personUrn
        };
    }

    // Token is expired. Check if we have a valid refresh token.
    if (!account.refreshToken || (account.refreshTokenExpiresAt && account.refreshTokenExpiresAt < now)) {
        // The refresh token is also expired (or doesn't exist). 
        // We must delete the account and force the user to log in again.
        await prisma.linkedinAccount.delete({ where: { adminId: adminId } });
        throw new Error("LinkedIn session expired. Please reconnect your account.");
    }

    // Use the refresh token to get a new access token
    const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: account.refreshToken,
            client_id: process.env.LINKEDIN_CLIENT_ID,
            client_secret: process.env.LINKEDIN_CLIENT_SECRET,
        }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
        throw new Error(tokenData.error_description || "Failed to refresh LinkedIn token.");
    }

    // Calculate new expiration dates
    const accessExpireDate = new Date(Date.now() + tokenData.expires_in * 1000);
    let refreshExpireDate = account.refreshTokenExpiresAt;
    
    if (tokenData.refresh_token_expires_in) {
        refreshExpireDate = new Date(Date.now() + tokenData.refresh_token_expires_in * 1000);
    }

    // Update the database with the new tokens
    await prisma.linkedinAccount.update({
        where: { adminId: adminId },
        data: {
            accessToken: tokenData.access_token,
            accessTokenExpiresAt: accessExpireDate,
            ...(tokenData.refresh_token && { refreshToken: tokenData.refresh_token }),
            ...(refreshExpireDate && { refreshTokenExpiresAt: refreshExpireDate }),
        }
    });

    return {
        accessToken: tokenData.access_token,
        personUrn: account.personUrn
    };
};