import prisma from '../config/prismaClient.js';
import { prepareCallingInstruction } from '../jobs/sarvamAgentService.js';


const CUSTOMER_SELECT = {
    id: true, customerName: true, ContactNumber: true, Campaign: true, CustomerType: true,
    CustomerSubType: true, LeadType: true, LeadTemperature: true, City: true, Location: true,
    SubLocation: true, Area: true, Price: true, Facillities: true, Description: true,
    Other: true, DealClosed: true,
};


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

        const { userPrompt, customerId, promptMode } = req.body;

        if (!userPrompt || !customerId) {
            return res.status(400).json({
                message: "userPrompt and customerId are required",
            });
        }

        // ---------------------------------------------------------
        // 3. Get customer (only the fields the agent needs)
        // ---------------------------------------------------------

        const customer = await prisma.customer.findUnique({
            where: { id: customerId },
            select: CUSTOMER_SELECT, // Password, images and site plans are never loaded
        });

        if (!customer) {
            return res.status(404).json({ message: "Customer not found" });
        }

        // ---------------------------------------------------------
        // 4. Customer phone number (checked before any AI call)
        // ---------------------------------------------------------

        const userPhoneNumber = String(customer.ContactNumber || "").trim();

        if (!userPhoneNumber) {
            return res.status(400).json({
                message: "Customer does not have a contact number",
            });
        }

        const formattedPhone = userPhoneNumber.startsWith("+")
            ? userPhoneNumber
            : `+91${userPhoneNumber}`;

        // ---------------------------------------------------------
        // 5. Get latest followups (newest first, max 5)
        // ---------------------------------------------------------

        const followups = await prisma.followup.findMany({
            where: { customerId },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: {
                StartDate: true,
                StatusType: true,
                FollowupNextDate: true,
                Description: true,
            },
        });

        // ---------------------------------------------------------
        // 6. Prepare calling instructions
        //    callingPrompt / aiAnswer -> shown in the UI (same as before)
        //    agentPrompt              -> sent to the voice agent
        // ---------------------------------------------------------

        const agentInstructions = await prepareCallingInstruction({
            customer,
            followups,
            userPrompt,
            promptMode,
        });

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

                    // Dynamic variables available to the agent (same names as before)
                    agent_variables: {
                        customer_name: customer.customerName,

                        dynamic_instruction:
                            agentInstructions.agentPrompt,

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
        // 12. Return success (same response shape as the old version)
        // ---------------------------------------------------------

        return res.status(200).json({
            success: true,

            message:
                "Sarvam instant outbound call initiated",

            attemptId:
                sarvamData.attempt_id || null,

            aiInstructions: {
                callingPrompt: agentInstructions.callingPrompt,
                aiAnswer: agentInstructions.aiAnswer,
            },

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

const SARVAM_MEDIA_HOST = "indus.sarvam.ai";
const MAX_REDIRECTS = 5;

const getApiKey = () =>
    process.env.VOICE_AGENT_API_KEY?.trim() || process.env.SARVAM_API_KEY?.trim();

/**
 * Turns whatever Sarvam sent into an absolute https URL the proxy can fetch.
 * Returns null for empty values and for data: URIs (which the proxy can't use).
 */
const toAbsoluteMediaUrl = (raw) => {
    if (!raw || typeof raw !== "string") return null;
    if (raw.startsWith("data:")) return null;
    try {
        return new URL(raw, `https://${SARVAM_MEDIA_HOST}`).href;
    } catch {
        return null;
    }
};

/*
 * ---------------------------------------------------------------------
 * Transcript helpers
 * The /interactions list does not include transcripts. They come from
 *   GET .../{app_id}/transcripts/{interaction_id}   (header: X-API-Key)
 * The response shape is not documented, so it is parsed defensively and
 * normalized to [{ role: "user" | "assistant", content: string }].
 * ---------------------------------------------------------------------
 */
const TRANSCRIPT_LIST_KEYS = ["transcript", "transcripts", "messages", "conversation", "turns", "entries", "history", "items", "data"];
const USER_ROLES = ["user", "customer", "human", "caller", "client"];
const HIDDEN_ROLES = ["system", "tool", "function"];

// Completed calls don't change, so non-empty transcripts are cached in memory
const transcriptCache = new Map();

const extractTranscriptList = (node, depth = 0) => {
    if (Array.isArray(node)) return node;
    if (node && typeof node === "object" && depth < 3) {
        for (const key of TRANSCRIPT_LIST_KEYS) {
            if (node[key] !== undefined) {
                const found = extractTranscriptList(node[key], depth + 1);
                if (found.length) return found;
            }
        }
    }
    return [];
};

const messageText = (value) => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(messageText).filter(Boolean).join(" ");
    if (value && typeof value === "object") return messageText(value.text ?? value.content ?? "");
    return "";
};

const normalizeTranscriptMessage = (m) => {
    if (typeof m === "string") return m.trim() ? { role: "assistant", content: m } : null;
    if (!m || typeof m !== "object") return null;

    const content = messageText(m.content ?? m.text ?? m.message ?? m.transcript ?? m.utterance ?? "").trim();
    if (!content) return null;

    const rawRole = String(m.role ?? m.speaker ?? m.sender ?? m.author ?? m.from ?? "").toLowerCase();
    if (HIDDEN_ROLES.includes(rawRole)) return null;

    return { ...m, role: USER_ROLES.includes(rawRole) ? "user" : "assistant", content };
};

const fetchInteractionTranscript = async (baseUrl, apiKey, interactionId) => {
    if (!interactionId) return [];
    if (transcriptCache.has(interactionId)) return transcriptCache.get(interactionId);

    // Ids look like "20261001/708190c5-14:52:06-45a45272": try fully encoded, then slash kept
    const variants = [...new Set([
        encodeURIComponent(interactionId),
        interactionId.split("/").map(encodeURIComponent).join("/"),
    ])];

    let lastStatus = null;
    for (const variant of variants) {
        try {
            const resp = await fetch(`${baseUrl}/transcripts/${variant}`, {
                method: "GET",
                headers: { "X-API-Key": apiKey, Accept: "application/json" },
                signal: AbortSignal.timeout(15000),
            });
            if (!resp.ok) {
                lastStatus = resp.status;
                continue;
            }

            const json = await resp.json().catch(() => null);
            const messages = extractTranscriptList(json).map(normalizeTranscriptMessage).filter(Boolean);

            if (messages.length) {
                transcriptCache.set(interactionId, messages);
            } else {
                const keys = json && typeof json === "object" ? Object.keys(json).join(", ") : typeof json;
                console.warn(`[transcript] ${interactionId}: 200 OK but no messages recognized. top-level: ${keys || "(empty)"}`);
            }
            return messages;
        } catch (e) {
            console.warn(`[transcript] ${interactionId}: request error: ${e.message}`);
        }
    }

    console.warn(`[transcript] ${interactionId}: failed${lastStatus ? ` (HTTP ${lastStatus})` : ""}`);
    return [];
};

// Runs fn over items with at most `limit` requests in flight
const mapWithConcurrency = async (items, limit, fn) => {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const idx = next++;
            results[idx] = await fn(items[idx], idx);
        }
    });
    await Promise.all(workers);
    return results;
};

/*
 * =====================================================================
 * GET /sarvam/call-logs  (your existing sync route)
 * Returns lightweight logs. recording_url is the RAW Sarvam media URL,
 * which the frontend passes to fetchSarvamAudio() on demand.
 * =====================================================================
 */
export const syncSarvamCallLogs = async (req, res) => {
    try {
        const apiKey = getApiKey();
        const orgId = process.env.SARVAM_ORG_ID?.trim();
        const workspaceId = process.env.SARVAM_WORKSPACE_ID?.trim();
        const appId = process.env.SARVAM_APP_ID?.trim();

        if (!apiKey || !orgId || !workspaceId || !appId) {
            return res.status(500).json({
                message: "Sarvam analytics configuration missing",
            });
        }

        const baseUrl = `https://apps.sarvam.ai/api/analytics/v1/${orgId}/${workspaceId}/${appId}`;

        // Last 30 days
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 30);

        const params = new URLSearchParams({
            start_datetime: start.toISOString(),
            end_datetime: end.toISOString(),
        });

        const interactionsResponse = await fetch(`${baseUrl}/interactions?${params.toString()}`, {
            method: "GET",
            headers: {
                "X-API-Key": apiKey,
                "Content-Type": "application/json",
            },
        });

        if (!interactionsResponse.ok) {
            const errorText = await interactionsResponse.text();
            return res.status(interactionsResponse.status).json({
                message: "Failed to fetch interactions from Sarvam API",
                details: errorText,
            });
        }

        const rawData = await interactionsResponse.json();

        let interactions = [];
        if (Array.isArray(rawData)) {
            interactions = rawData;
        } else if (rawData.data && Array.isArray(rawData.data)) {
            interactions = rawData.data;
        } else if (rawData.interactions && Array.isArray(rawData.interactions)) {
            interactions = rawData.interactions;
        } else if (rawData.items && Array.isArray(rawData.items)) {
            interactions = rawData.items;
        } else {
            interactions = Object.values(rawData).find(Array.isArray) || [];
        }

        const finalLogs = await mapWithConcurrency(interactions, 5, async (log) => {
            // Use an inline transcript if the list ever includes one
            let transcriptArray = [];
            if (Array.isArray(log.transcript)) {
                transcriptArray = log.transcript;
            } else if (log.transcript && Array.isArray(log.transcript.messages)) {
                transcriptArray = log.transcript.messages;
            }

            // Otherwise fetch it from the official transcripts endpoint.
            // Skip calls that clearly never connected (0 seconds, 0 messages).
            const neverConnected = log.duration_in_seconds === 0 && !log.num_messages;
            if (!transcriptArray.length && !neverConnected) {
                transcriptArray = await fetchInteractionTranscript(baseUrl, apiKey, log.interaction_id);
            }

            const recordingUrl = toAbsoluteMediaUrl(log.audio_url || log.recording_url);

            return {
                ...log,
                transcript: transcriptArray,
                recording_url: recordingUrl, // raw URL, NOT base64
                has_recording: Boolean(recordingUrl),
            };
        });

        // Debug aid: confirms what the frontend will receive
        const withAudio = finalLogs.filter((l) => l.has_recording);
        console.log(
            `[sync] ${finalLogs.length} logs, ${withAudio.length} with recording.`,
            withAudio[0] ? `Sample host: ${new URL(withAudio[0].recording_url).hostname}` : "No recording URLs found"
        );

        console.log(`[sync] ${finalLogs.filter((l) => l.transcript.length > 0).length}/${finalLogs.length} logs have a transcript.`);

        return res.status(200).json({
            success: true,
            count: finalLogs.length,
            logs: finalLogs,
        });
    } catch (error) {
        console.error("Sarvam call log sync failed:", error);
        return res.status(500).json({
            message: "Internal server error",
            error: error.message,
        });
    }
};


/*
 * =====================================================================
 * GET /sarvam/audio?recordingUrl=<recording_url>
 *
 * The indus.sarvam.ai/media link is a dashboard link and is blocked for
 * server requests (403 from Cloudflare). Instead we read the
 * interaction_id out of that link and call Sarvam's official endpoint:
 *   GET https://apps.sarvam.ai/api/analytics/v1/{org}/{ws}/{app}/recordings/{interaction_id}
 * (header: X-API-Key). The response may be the audio itself or JSON that
 * points to the file, so both are handled.
 * =====================================================================
 */
const ANALYTICS_HOST = "apps.sarvam.ai";
const BROWSER_UA = "Mozilla/5.0 (compatible; VoiceAgentServer/1.0)";

// Turn error bodies (especially HTML block pages) into a short readable string
const summarizeBody = (text) => {
    const t = String(text || "");
    if (/^\s*<(!doctype|html)/i.test(t)) {
        const title = t.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
        return `HTML error page${title ? `: ${title}` : ""}`;
    }
    return t.slice(0, 300);
};

// Detect the real audio format from the file's first bytes
const sniffAudioType = (buf) => {
    const head = buf.subarray(0, 4).toString("latin1");
    if (head === "RIFF") return "audio/wav";
    if (head === "OggS") return "audio/ogg";
    if (head === "fLaC") return "audio/flac";
    if (head.startsWith("ID3") || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return "audio/mpeg";
    if (buf.subarray(4, 8).toString("latin1") === "ftyp") return "audio/mp4";
    return null;
};

// First http(s) URL found anywhere inside a JSON value
const findUrlInJson = (node) => {
    if (typeof node === "string") return /^https?:\/\//i.test(node) ? node : null;
    if (node && typeof node === "object") {
        for (const v of Object.values(node)) {
            const found = findUrlInJson(v);
            if (found) return found;
        }
    }
    return null;
};

// GET with manual redirects. The API key is sent only to Sarvam hosts, never to S3/CDN.
const fetchFollowingRedirects = async (startUrl, apiKey, label) => {
    let current = new URL(startUrl);
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
        const isSarvam = current.hostname === ANALYTICS_HOST || current.hostname === SARVAM_MEDIA_HOST;
        const resp = await fetch(current.href, {
            method: "GET",
            redirect: "manual",
            headers: {
                "User-Agent": BROWSER_UA,
                Accept: "audio/*,application/json;q=0.9,*/*;q=0.8",
                ...(isSarvam ? { "X-API-Key": apiKey } : {}),
            },
        });
        console.log(`[audio] ${label} hop ${i}: ${resp.status} ${current.hostname} (${resp.headers.get("content-type") || "no content-type"})`);

        const location = resp.headers.get("location");
        if (resp.status >= 300 && resp.status < 400 && location) {
            const next = new URL(location, current);
            if (next.protocol !== "https:") throw new Error("Insecure redirect blocked");
            current = next;
            continue;
        }
        return resp;
    }
    throw new Error("Too many redirects");
};

export const streamSarvamAudio = async (req, res) => {
    try {
        const apiKey = getApiKey();
        const orgId = process.env.SARVAM_ORG_ID?.trim();
        const workspaceId = process.env.SARVAM_WORKSPACE_ID?.trim();
        const appId = process.env.SARVAM_APP_ID?.trim();
        if (!apiKey || !orgId || !workspaceId || !appId) {
            return res.status(500).json({ message: "Sarvam configuration missing" });
        }

        // Frontend sends ?recordingUrl=...; ?url=... is also accepted
        const rawUrl = req.query.recordingUrl || req.query.url;
        let target;
        try {
            target = new URL(String(rawUrl || ""));
        } catch {
            console.error("[audio] invalid url param:", rawUrl);
            return res.status(400).json({ message: "Invalid audio url" });
        }
        if (target.protocol !== "https:" || target.hostname !== SARVAM_MEDIA_HOST) {
            return res.status(400).json({ message: "Audio host not allowed" });
        }

        const interactionId = target.searchParams.get("interaction_id");
        if (!interactionId) {
            return res.status(400).json({ message: "recordingUrl has no interaction_id" });
        }

        // The id looks like "20261001/708190c5-14:52:06-45a45272" (contains "/" and ":").
        // Try it fully encoded first, then with the slash kept as a path separator.
        const base = `https://${ANALYTICS_HOST}/api/analytics/v1/${orgId}/${workspaceId}/${appId}/recordings`;
        const candidates = [
            `${base}/${encodeURIComponent(interactionId)}`,
            `${base}/${interactionId.split("/").map(encodeURIComponent).join("/")}`,
        ];

        let upstream;
        for (const [idx, url] of candidates.entries()) {
            upstream = await fetchFollowingRedirects(url, apiKey, `recordings#${idx}`);
            if (upstream.ok) break;
            console.error(`[audio] recordings#${idx} failed: ${upstream.status}`);
        }

        if (!upstream.ok) {
            const body = summarizeBody(await upstream.text());
            console.error(`[audio] recordings API failed: ${upstream.status}`, body);
            return res.status(502).json({
                message: `Sarvam recordings API returned ${upstream.status}`,
                details: body,
            });
        }

        let buffer = Buffer.from(await upstream.arrayBuffer());
        let contentType = upstream.headers.get("content-type") || "";

        // JSON response: expect a link to the actual file
        if (contentType.includes("json") || buffer[0] === 0x7b /* "{" */ || buffer[0] === 0x22 /* '"' */) {
            let json;
            try {
                json = JSON.parse(buffer.toString("utf8"));
            } catch { /* not JSON after all; fall through to the audio check */ }

            if (json !== undefined) {
                const fileUrl = findUrlInJson(json);
                if (!fileUrl) {
                    const keys = json && typeof json === "object" ? Object.keys(json).join(", ") : typeof json;
                    console.error("[audio] JSON without a file url. keys:", keys);
                    return res.status(502).json({
                        message: "Recordings API returned JSON without an audio URL",
                        details: `keys: ${keys || "(empty)"}`,
                    });
                }
                if (!/^https:/i.test(fileUrl)) {
                    return res.status(502).json({ message: "Recording link is not https" });
                }

                const fileResp = await fetchFollowingRedirects(fileUrl, apiKey, "file");
                if (!fileResp.ok) {
                    const body = summarizeBody(await fileResp.text());
                    console.error(`[audio] file fetch failed: ${fileResp.status}`, body);
                    return res.status(502).json({
                        message: `Recording file returned ${fileResp.status}`,
                        details: body,
                    });
                }
                buffer = Buffer.from(await fileResp.arrayBuffer());
                contentType = fileResp.headers.get("content-type") || "";
            }
        }

        const type = sniffAudioType(buffer) || (contentType.startsWith("audio/") ? contentType : null);
        if (!type) {
            const preview = summarizeBody(buffer.subarray(0, 300).toString("utf8"));
            console.error("[audio] response is not audio:", contentType, preview);
            return res.status(502).json({
                message: "Sarvam did not return audio",
                details: `content-type=${contentType}; body=${preview}`,
            });
        }

        res.set({
            "Content-Type": type,
            "Content-Length": buffer.length,
            "Cache-Control": "private, max-age=3600",
        });
        return res.status(200).send(buffer);
    } catch (error) {
        console.error("Audio proxy failed:", error);
        return res.status(500).json({ message: "Audio proxy failed", details: error.message });
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