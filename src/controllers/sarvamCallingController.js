import prisma from '../config/prismaClient.js';
import { generateSarvamAgentInstructions } from '../jobs/sarvamAgentService.js';

// ---------------------------------------------------------------------------
// 1) Outbound call (Sarvam Conversations API, apps.sarvam.ai, X-API-Key)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// 2) Webhook (Sarvam POSTs here after each call attempt)
// ---------------------------------------------------------------------------
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
        callStatus: payload.status,             // "connected" | "failed"
        callDuration: payload.duration ?? null, // null if the call didn't connect
        rawJson: payload,                       // includes interaction_id, final_agent_variables
      },
    });

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Sarvam Webhook processing failed:", error);
    return res.status(500).json({ message: "Webhook processing failed" });
  }
};

// ---------------------------------------------------------------------------
// 3) TTS test (Sarvam model API, api.sarvam.ai, api-subscription-key)
//    Diagnostic only: confirms whether a key works on the model API.
// ---------------------------------------------------------------------------
export const sarvamTtsTest = async (req, res) => {
  try {
    // Uses SARVAM_MODEL_API_KEY if set, otherwise falls back to SARVAM_API_KEY
    const apiKey = (process.env.SARVAM_MODEL_API_KEY || process.env.SARVAM_API_KEY)?.trim();
    if (!apiKey) {
      return res.status(500).json({ message: "No Sarvam key loaded from .env" });
    }

    const { text = "Hello, this is a Sarvam text to speech test." } = req.body || {};

    const response = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey, // different header than the Conversations API
      },
      body: JSON.stringify({
        text,
        target_language_code: "en-IN",
        model: "bulbul:v3",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Sarvam TTS error:", response.status, data);
      return res.status(response.status).json({
        message: "Sarvam TTS rejected the request",
        details: data,
      });
    }

    const audios = Array.isArray(data.audios) ? data.audios : [];
    return res.status(200).json({
      success: true,
      message: "TTS call succeeded, so this key is valid for the Sarvam model API",
      audioCount: audios.length,
      firstAudioBase64Length: audios[0]?.length ?? 0,
      requestId: data.request_id,
    });
  } catch (error) {
    console.error("Sarvam TTS test failed:", error);
    return res.status(500).json({ message: "TTS test failed", error: error.message });
  }
};