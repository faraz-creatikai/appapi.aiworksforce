import prisma from "../config/prismaClient.js";

// ---------------------------------------------------------------------------
// CONFIGURATION RESOLVER: DB First, Fallback to .env
// ---------------------------------------------------------------------------
export const getActiveSarvamConfig = async () => {
    try {
        // Find the single active agent configuration in the database
        const activeAgent = await prisma.callingAgentConfig.findFirst({
            where: { isActive: true }
        });

        return {
            apiKey: (activeAgent?.apiKey || process.env.VOICE_AGENT_API_KEY || process.env.SARVAM_API_KEY)?.trim(),
            orgId: (activeAgent?.orgId || process.env.SARVAM_ORG_ID)?.trim(),
            workspaceId: (activeAgent?.workspaceId || process.env.SARVAM_WORKSPACE_ID)?.trim(),
            appId: (activeAgent?.appId || process.env.SARVAM_APP_ID)?.trim(),
            // Capture appVersion dynamically (DB -> ENV -> Default 12)
            appVersion: activeAgent?.appVersion || parseInt(process.env.SARVAM_APP_VERSION) || 12,
            connectionId: (activeAgent?.connectionId || process.env.SARVAM_CONNECTION_ID)?.trim(),
            agentPhoneNumber: (activeAgent?.callerNumber || process.env.SARVAM_CALLER_NUMBER)?.trim(),
            agentTansferNumber: (activeAgent?.transferNumber || process.env.SARVAM_TRANSFER_NUMBER)?.trim(),
            // Webhook URL strictly remains from .env
            webhookBase: process.env.WEBHOOK_BASE_URL?.trim().replace(/\/$/, ""),
        };
    } catch (error) {
        console.error("Failed to fetch active Sarvam config from DB, falling back to .env:", error.message);
        return {
            apiKey: (process.env.VOICE_AGENT_API_KEY || process.env.SARVAM_API_KEY)?.trim(),
            orgId: process.env.SARVAM_ORG_ID?.trim(),
            workspaceId: process.env.SARVAM_WORKSPACE_ID?.trim(),
            appId: process.env.SARVAM_APP_ID?.trim(),
            appVersion: parseInt(process.env.SARVAM_APP_VERSION) || 12,
            connectionId: process.env.SARVAM_CONNECTION_ID?.trim(),
            agentPhoneNumber: process.env.SARVAM_CALLER_NUMBER?.trim(),
            agentTansferNumber: process.env.SARVAM_TRANSFER_NUMBER?.trim(),
            webhookBase: process.env.WEBHOOK_BASE_URL?.trim().replace(/\/$/, ""),
        };
    }
};