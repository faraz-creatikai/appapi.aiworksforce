import prisma from '../config/prismaClient.js';
import { generateSarvamAgentInstructions } from '../jobs/sarvamAgentService.js';
import https from 'https'; // 🚨 Node native - completely avoids 'fetch'

// --- Configuration (all from .env) ---
const SARVAM_API_KEY = process.env.SARVAM_API_KEY?.trim();
const SARVAM_ORG_ID = process.env.SARVAM_ORG_ID?.trim();
const SARVAM_WORKSPACE_ID = process.env.SARVAM_WORKSPACE_ID?.trim();
const SARVAM_APP_ID = process.env.SARVAM_APP_ID?.trim();
const SARVAM_CONNECTION_ID = process.env.SARVAM_CONNECTION_ID?.trim();
const SARVAM_CALLER_NUMBER = process.env.SARVAM_CALLER_NUMBER?.trim();
const WEBHOOK_BASE_URL = "http:/localhost:5000"; // must be publicly reachable

export const triggerSarvamCall = async (req, res, next) => {
  try {
    const { userPrompt, customerId } = req.body;

    if (!userPrompt || !customerId) {
      return res.status(400).json({ message: "userPrompt and customerId are required" });
    }

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    const followups = await prisma.followup.findMany({
      where: { customerId },
      orderBy: { createdAt: "asc" },
    });

    const agentInstructions = await generateSarvamAgentInstructions({
      customer,
      followups,
      userPrompt,
    });

    // --- Official Sarvam outbound call ---
    const url = `https://apps.sarvam.ai/api/outbounds/v1/orgs/${SARVAM_ORG_ID}/workspaces/${SARVAM_WORKSPACE_ID}/outbounds`;

    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": SARVAM_API_KEY,
      },
      body: JSON.stringify({
        app_config: {
          app_id: SARVAM_APP_ID,
          app_version: 1,
          connection_config: {
            connection_id: SARVAM_CONNECTION_ID,
            agent_phone_number: SARVAM_CALLER_NUMBER,
          },
        },
        user_config: {
          user_phone_number: `+91${customer.ContactNumber}`,
          variables: {
            dynamic_instruction: agentInstructions.callingPrompt,
            customer_name: customer.customerName,
          },
        },
        webhook_config: {
          url: `${WEBHOOK_BASE_URL}/api/sarvam/sarvamCallWebhook`,
          metadata: { customerId: customer.id },
        },
      }),
    };

    const response = await fetch(url, options);
    const sarvamData = await response.json();

    if (!response.ok) {
      console.error("Sarvam API error:", response.status, sarvamData);
      return res.status(response.status).json({
        message: "Sarvam API rejected the request",
        details: sarvamData,
      });
    }

    // Create initial call log
    const callLogRecord = await prisma.sarvamCallLog.create({
      data: {
        participantIdentity:
          sarvamData.interaction_id || sarvamData.outbound_id || `indus_${Date.now()}`,
        sarvamAppId: SARVAM_APP_ID,
        orgId: SARVAM_ORG_ID,
        workspaceId: SARVAM_WORKSPACE_ID,
        calledTo: `+91${customer.ContactNumber}`,
        customerId: customer.id,
        rawJson: sarvamData,
      },
    });

    return res.status(200).json({
      success: true,
      message: "AI Agent dispatched successfully",
      aiInstructions: agentInstructions,
      callLogId: callLogRecord.id,
      sarvamData,
    });
  } catch (error) {
    console.error("Sarvam trigger failed:", error);
    res.status(500).json({ message: "Internal server error triggering call" });
  }
};


export const sarvamCallWebhook = async (req, res) => {
  try {
    const payload = req.body;
    const attemptId = payload.attempt_id;

    if (!attemptId) {
      return res.status(400).json({ message: "attempt_id missing" });
    }

    await prisma.sarvamCallLog.updateMany({
      where: { participantIdentity: attemptId },
      data: {
        callStatus: payload.status,          // "connected" | "failed"
        callDuration: payload.duration ?? null, // null if the call didn't connect
        rawJson: payload,                    // includes interaction_id, final_agent_variables
      },
    });

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Sarvam Webhook processing failed:", error);
    return res.status(500).json({ message: "Webhook processing failed" });
  }
};
