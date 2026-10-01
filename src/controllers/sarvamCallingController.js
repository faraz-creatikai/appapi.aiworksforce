import prisma from '../config/prismaClient.js';
import { generateSarvamAgentInstructions } from '../jobs/sarvamAgentService.js';

export const triggerSarvamCall = async (req, res, next) => {
  try {
    // Read env at request time, not at import time
    const cfg = {
      apiKey: process.env.SARVAM_API_KEY?.trim(),
      orgId: process.env.SARVAM_ORG_ID?.trim(),
      workspaceId: process.env.SARVAM_WORKSPACE_ID?.trim(),
      appId: process.env.SARVAM_APP_ID?.trim(),
      connectionId: process.env.SARVAM_CONNECTION_ID?.trim(),
      callerNumber: process.env.SARVAM_CALLER_NUMBER?.trim(),
      webhookBase: process.env.WEBHOOK_BASE_URL?.trim().replace(/\/$/, ""),
    };

    const missing = Object.entries(cfg).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
      console.error("Missing Sarvam env vars:", missing);
      return res.status(500).json({ message: "Server misconfigured", missing });
    }
    console.log(`Sarvam key: len=${cfg.apiKey.length}, prefix=${cfg.apiKey.slice(0, 3)}`);

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

    const url = `https://apps.sarvam.ai/api/outbounds/v1/orgs/${cfg.orgId}/workspaces/${cfg.workspaceId}/outbounds`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": cfg.apiKey,
      },
      body: JSON.stringify({
        app_config: {
          app_id: cfg.appId,
          app_version: 1,
          connection_config: {
            connection_id: cfg.connectionId,
            agent_phone_number: cfg.callerNumber,
          },
          agent_variables: {
            dynamic_instruction: agentInstructions.callingPrompt,
            customer_name: customer.customerName,
          },
        },
        user_config: {
          user_phone_number: `+91${customer.ContactNumber}`,
        },
        webhook_config: {
          url: `${cfg.webhookBase}/api/sarvam/sarvamCallWebhook`,
          metadata: { customerId: customer.id },
        },
      }),
    });

    const sarvamData = await response.json();

    if (!response.ok) {
      console.error("Sarvam API error:", response.status, sarvamData);
      return res.status(response.status).json({
        message: "Sarvam API rejected the request",
        details: sarvamData,
      });
    }

    const callLogRecord = await prisma.sarvamCallLog.create({
      data: {
        participantIdentity: sarvamData.attempt_id,
        sarvamAppId: cfg.appId,
        orgId: cfg.orgId,
        workspaceId: cfg.workspaceId,
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

// sarvamCallWebhook stays exactly as you have it


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
