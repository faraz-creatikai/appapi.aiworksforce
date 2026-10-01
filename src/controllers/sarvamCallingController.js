import prisma from '../config/prismaClient.js';
import { generateSarvamAgentInstructions } from '../jobs/sarvamAgentService.js';



export const triggerSarvamCall = async (req, res, next) => {
    try {
        // ---------------------------------------------------------
        // 1. Read environment variables
        // ---------------------------------------------------------

        const cfg = {
            apiKey: process.env.VOICE_AGENT_API_KEY?.trim(),

            orgId: process.env.SARVAM_ORG_ID?.trim(),

            workspaceId: process.env.SARVAM_WORKSPACE_ID?.trim(),

            appId: process.env.SARVAM_APP_ID?.trim(),

            connectionId: process.env.SARVAM_CONNECTION_ID?.trim(),

            agentPhoneNumber: process.env.SARVAM_CALLER_NUMBER?.trim(),

            webhookBase: process.env.WEBHOOK_BASE_URL
                ?.trim()
                .replace(/\/$/, ""),
        };

        const missing = Object.entries(cfg)
            .filter(([, value]) => !value)
            .map(([key]) => key);

        if (missing.length) {
            console.error("Missing Sarvam env vars:", missing);

            return res.status(500).json({
                message: "Server misconfigured",
                missing,
            });
        }

        console.log(
            `Sarvam key: len=${cfg.apiKey.length}, prefix=${cfg.apiKey.slice(0, 3)}`
        );

        // ---------------------------------------------------------
        // 2. Request body
        // ---------------------------------------------------------

        const { userPrompt, customerId } = req.body;

        if (!userPrompt || !customerId) {
            return res.status(400).json({
                message: "userPrompt and customerId are required",
            });
        }

        // ---------------------------------------------------------
        // 3. Get customer
        // ---------------------------------------------------------

        const customer = await prisma.customer.findUnique({
            where: { id: customerId },
        });

        if (!customer) {
            return res.status(404).json({
                message: "Customer not found",
            });
        }

        // ---------------------------------------------------------
        // 4. Get followups
        // ---------------------------------------------------------

        const followups = await prisma.followup.findMany({
            where: { customerId },
            orderBy: { createdAt: "asc" },
        });

        // ---------------------------------------------------------
        // 5. Generate dynamic calling instructions
        // ---------------------------------------------------------

        const agentInstructions =
            await generateSarvamAgentInstructions({
                customer,
                followups,
                userPrompt,
            });

        // ---------------------------------------------------------
        // 6. Customer phone number
        // ---------------------------------------------------------

        const userPhoneNumber = String(
            customer.ContactNumber || ""
        ).trim();

        if (!userPhoneNumber) {
            return res.status(400).json({
                message: "Customer does not have a contact number",
            });
        }

        const formattedPhone = userPhoneNumber.startsWith("+")
            ? userPhoneNumber
            : `+91${userPhoneNumber}`;

        // ---------------------------------------------------------
        // 7. Instant Outbound API
        // ---------------------------------------------------------

        const url =
            `https://apps.sarvam.ai/api/outbounds/v1` +
            `/orgs/${cfg.orgId}` +
            `/workspaces/${cfg.workspaceId}` +
            `/outbounds`;

        console.log("Sarvam instant outbound URL:", url);

        // ---------------------------------------------------------
        // 8. Create outbound call
        // ---------------------------------------------------------

        const response = await fetch(url, {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "X-API-Key": cfg.apiKey,
            },

            body: JSON.stringify({
                app_config: {
                    app_id: cfg.appId,

                    // Use the committed agent version.
                    // Change this if your current committed version
                    // is different.
                    app_version: 4,

                    connection_config: {
                        connection_id: cfg.connectionId,

                        // THIS was the missing field
                        agent_phone_number: cfg.agentPhoneNumber,
                    },

                    // Dynamic variables available to the agent
                    agent_variables: {
                        customer_name: customer.customerName,

                        dynamic_instruction:
                            agentInstructions.callingPrompt,

                        customer_id: customer.id,

                        user_prompt: userPrompt,
                    },

                    app_type: "agent",
                },

                user_config: {
                    user_phone_number: formattedPhone,
                },

                webhook_config: {
                    url: cfg.webhookBase,

                    metadata: {
                        customer_id: customer.id,
                    },
                },
            }),
        });

        // ---------------------------------------------------------
        // 9. Parse Sarvam response
        // ---------------------------------------------------------

        const sarvamText = await response.text();

        let sarvamData;

        try {
            sarvamData = JSON.parse(sarvamText);
        } catch {
            sarvamData = {
                raw_response: sarvamText,
            };
        }

        // ---------------------------------------------------------
        // 10. Handle Sarvam error
        // ---------------------------------------------------------

        if (!response.ok) {
            console.error(
                "Sarvam instant outbound error:",
                response.status,
                sarvamData
            );

            return res.status(response.status).json({
                message: "Sarvam outbound call rejected",
                details: sarvamData,
            });
        }

        // ---------------------------------------------------------
        // 11. Save call log
        // ---------------------------------------------------------

        const callLogRecord =
            await prisma.sarvamCallLog.create({
                data: {
                    participantIdentity:
                        sarvamData.attempt_id || null,

                    sarvamAppId: cfg.appId,

                    orgId: cfg.orgId,

                    workspaceId: cfg.workspaceId,

                    calledTo: formattedPhone,

                    customerId: customer.id,

                    rawJson: {
                        attempt_id:
                            sarvamData.attempt_id || null,

                        outbound_response:
                            sarvamData,

                        generated_instructions:
                            agentInstructions,

                        phone_number:
                            formattedPhone,

                        agent_phone_number:
                            cfg.agentPhoneNumber,

                        app_id:
                            cfg.appId,

                        connection_id:
                            cfg.connectionId,
                    },
                },
            });

        // ---------------------------------------------------------
        // 12. Return success
        // ---------------------------------------------------------

        return res.status(200).json({
            success: true,

            message:
                "Sarvam instant outbound call initiated",

            attemptId:
                sarvamData.attempt_id || null,

            aiInstructions:
                agentInstructions,

            callLogId:
                callLogRecord.id,

            customerId:
                customer.id,

            calledTo:
                formattedPhone,

            agentPhoneNumber:
                cfg.agentPhoneNumber,

            sarvamData,
        });
    } catch (error) {
        console.error(
            "Sarvam instant outbound call failed:",
            error
        );

        return res.status(500).json({
            message:
                "Internal server error triggering Sarvam outbound call",

            error: error.message,
        });
    }
};

// ---------------------------------------------------------------------------
// 2) Webhook (Sarvam POSTs here after each call attempt)
// ---------------------------------------------------------------------------
export const sarvamCallWebhook = async (req, res) => {
    try {
        const payload = req.body;

        console.log(
            "========== SARVAM WEBHOOK RECEIVED =========="
        );

        console.log(
            JSON.stringify(payload, null, 2)
        );

        const attemptId =
            payload.attempt_id ||
            payload.interaction_id;

        if (!attemptId) {
            console.error(
                "Sarvam webhook: attempt_id / interaction_id missing"
            );

            return res.status(400).json({
                message:
                    "attempt_id or interaction_id missing",
            });
        }

        const metadataCustomerId =
            payload.metadata?.customer_id || null;

        const updateData = {
            callDuration:
                payload.duration != null
                    ? Math.round(Number(payload.duration))
                    : null,

            startTime: payload.start_datetime
                ? new Date(payload.start_datetime)
                : null,

            endTime: payload.end_datetime
                ? new Date(payload.end_datetime)
                : null,

            transcript:
                payload.interaction_transcript
                    ? JSON.stringify(
                          payload.interaction_transcript
                      )
                    : null,

            rawJson: payload,
        };

        // If Sarvam sends a customer ID through metadata
        // and the existing record does not have one,
        // update it as well.
        if (metadataCustomerId) {
            updateData.customerId =
                metadataCustomerId;
        }

        const result =
            await prisma.sarvamCallLog.updateMany({
                where: {
                    participantIdentity: attemptId,
                },

                data: updateData,
            });

        console.log(
            "Sarvam call log updated:",
            {
                attemptId,
                updatedRecords: result.count,
            }
        );

        return res.status(200).json({
            received: true,
            updatedRecords: result.count,
        });
    } catch (error) {
        console.error(
            "Sarvam Webhook processing failed:",
            error
        );

        return res.status(500).json({
            message:
                "Webhook processing failed",
            error: error.message,
        });
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

// ---------------------------------------------------------------------------
// 4) Auth diagnostic (read-only): tries header/org-id combinations against the
//    Conversations gateway and reports which ones get past authentication.
//    Any status other than 401 means that combination passed auth.
// ---------------------------------------------------------------------------
export const sarvamAuthDiagnose = async (req, res) => {
    try {
        const key = process.env.SARVAM_API_KEY?.trim();
        const workspaceId = process.env.SARVAM_WORKSPACE_ID?.trim();
        if (!key || !workspaceId) {
            return res.status(500).json({ message: "SARVAM_API_KEY or SARVAM_WORKSPACE_ID not loaded" });
        }

        // Org IDs to try: the one from .env, plus the short id embedded in the key (sk_<orgId>_...)
        const keyOrgId = key.split("_")[1];
        const orgIds = [...new Set([process.env.SARVAM_ORG_ID?.trim(), keyOrgId].filter(Boolean))];

        const headerVariants = {
            "X-API-Key": { "X-API-Key": key },
            "api-subscription-key": { "api-subscription-key": key },
            "Authorization: Bearer": { Authorization: `Bearer ${key}` },
        };

        const results = [];
        for (const orgId of orgIds) {
            for (const [headerName, headers] of Object.entries(headerVariants)) {
                const url = `https://apps.sarvam.ai/api/app-authoring/v1/orgs/${orgId}/workspaces/${workspaceId}/deployments`;
                try {
                    const r = await fetch(url, { method: "GET", headers });
                    const text = await r.text();
                    results.push({
                        orgId,
                        header: headerName,
                        status: r.status,
                        passedAuth: r.status !== 401,
                        body: text.slice(0, 200),
                    });
                } catch (e) {
                    results.push({ orgId, header: headerName, error: e.message });
                }
            }
        }

        return res.status(200).json({ keyLength: key.length, results });
    } catch (error) {
        console.error("Sarvam auth diagnose failed:", error);
        return res.status(500).json({ message: "Diagnostic failed", error: error.message });
    }
};