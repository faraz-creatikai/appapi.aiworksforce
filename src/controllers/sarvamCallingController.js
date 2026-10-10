import prisma from '../config/prismaClient.js';
import { sendBaileysWhatsApp } from '../config/twilio.js';
import { prepareCallingInstruction } from '../jobs/sarvamAgentService.js';
import { getActiveSarvamConfig } from '../utils/callingAgentConfig.js';



const CUSTOMER_SELECT = {
    id: true, customerName: true, ContactNumber: true, Campaign: true, CustomerType: true,
    CustomerSubType: true, LeadType: true, LeadTemperature: true, City: true, Location: true,
    SubLocation: true, Area: true, Price: true, Facillities: true, Description: true,
    Other: true, DealClosed: true,
};


export const triggerSarvamCall = async (req, res, next) => {
    try {
        // ---------------------------------------------------------
        // 1. Read environment variables (Now dynamic with DB fallback)
        // ---------------------------------------------------------

        const cfg = await getActiveSarvamConfig();

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
                    app_version: cfg.appVersion,

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
                        transfer_number: cfg.agentTansferNumber || null,
                    },

                    app_type: "agent",
                    app_overrides: {
                        // 1. Strict cost-control boundaries
                        /*    conversation_config: {
                               // Failsafe: Hard cut-off at 3 minutes (180 seconds). 
                               // Adjust this based on your ideal sales pitch length.
                               max_duration_seconds: 180, 
                               
                               // Failsafe: Hang up if the user is completely silent for 15 seconds
                               idle_timeout_seconds: 15,
                           }, */

                        // 2. Drop the call immediately if it hits a voicemail box
                        telephony_config: {
                            answering_machine_detection: "hangup"
                        }
                    }
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
// Webhook (Sarvam POSTs here after each call attempt)
// ---------------------------------------------------------------------------
export const sarvamCallWebhook = async (req, res) => {
    try {
        const p = req.body || {};
        console.log("SARVAM WEBHOOK RECEIVED:", JSON.stringify(p));

        const attemptId = p.attempt_id;
        if (!attemptId) {
            return res.status(400).json({ message: "attempt_id missing" });
        }

        const existing = await prisma.sarvamCallLog.findFirst({
            where: { participantIdentity: attemptId },
            select: { id: true, calledTo: true, rawJson: true },
        });

        if (!existing) {
            // Still return 200 so Sarvam doesn't retry; the log row was never created.
            console.warn("Webhook for unknown attempt:", attemptId);
            return res.status(200).json({ received: true, updatedRecords: 0 });
        }

        // Duplicate delivery guard
        if (existing.rawJson?.webhook?.attempt_id === attemptId) {
            return res.status(200).json({ received: true, duplicate: true });
        }

        const endTime = new Date(); // webhook fires after the call; Sarvam sends no timestamps
        const duration = p.duration != null ? Math.round(Number(p.duration)) : null;

        const updateData = {
            callDuration: duration,
            endTime,
            ...(duration != null && { startTime: new Date(endTime.getTime() - duration * 1000) }),
            ...(p.interaction_transcript && { transcript: JSON.stringify(p.interaction_transcript) }),
            // Keep what the trigger saved, add the webhook result alongside it
            rawJson: { ...(existing.rawJson || {}), webhook: p },
        };

        const metaCustomerId = p.webhook_config?.metadata?.customer_id;
        if (metaCustomerId) updateData.customerId = metaCustomerId;

        await prisma.sarvamCallLog.update({
            where: { id: existing.id },
            data: updateData,
        });

        // Only message people whose call actually connected
        if (p.status === "connected" && existing.calledTo) {
            const waNumber = existing.calledTo.replace("+", "");
            const waMessage = `Hi! Thank you for speaking with our AI voice agent. Let us know if you have any further questions.`;
            sendBaileysWhatsApp(waNumber, waMessage).catch((err) =>
                console.error(`WhatsApp failed for ${waNumber}:`, err.message)
            );
        }

        return res.status(200).json({ received: true, status: p.status });
    } catch (error) {
        console.error("Sarvam webhook failed:", error);
        return res.status(500).json({ message: "Webhook processing failed", error: error.message });
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




// Last 10 digits, so "+91 78781 72452" and "7878172452" compare equal
const last10 = (v) => String(v ?? "").replace(/\D/g, "").slice(-10);

// Sarvam start_datetime is UTC with no "Z" (e.g. "2026-10-05T09:11:26")
const logTime = (log) => {
    const s = String(log?.start_datetime ?? "");
    if (!s) return NaN;
    return new Date(/[zZ]$\vert{}[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`).getTime();
};

const extractInteractions = (rawData) => {
    if (Array.isArray(rawData)) return rawData;
    if (Array.isArray(rawData?.data)) return rawData.data;
    if (Array.isArray(rawData?.interactions)) return rawData.interactions;
    if (Array.isArray(rawData?.items)) return rawData.items;
    return Object.values(rawData || {}).find(Array.isArray) || [];
};

// ---- where the customer id / phone can live inside a Sarvam interaction ----
const getLogCustomerId = (log) => {
    const raw =
        log?.agent_variables?.customer_id ||
        log?.metadata?.customer_id ||
        log?.webhook_config?.metadata?.customer_id ||
        log?.app_config?.agent_variables?.customer_id;
    return raw ? String(raw) : "";
};

const getLogPhone = (log) =>
    log?.user_contact ||
    log?.user_phone_number ||
    log?.user_config?.user_phone_number ||
    log?.phone_number ||
    log?.called_to ||
    "";

/*
 * Gets EVERY interaction between start and end. No round limit and no early
 * exit on a "short" page. It stops only when a request returns nothing new,
 * which always happens because every round must add at least one unseen call.
 */
const fetchAllInteractions = async (baseUrl, apiKey, start, end) => {
    const seen = new Map(); // interaction_id -> log (dedupes the overlap)
    let from = start.getTime();
    let to = end.getTime();
    let direction = null; // "asc" (oldest first) or "desc", detected from the first response
    let rounds = 0;

    while (true) {
        rounds++;
        const params = new URLSearchParams({
            start_datetime: new Date(from).toISOString(),
            end_datetime: new Date(to).toISOString(),
        });

        const resp = await fetch(`${baseUrl}/interactions?${params.toString()}`, {
            method: "GET",
            headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        });

        if (!resp.ok) {
            const err = new Error("Failed to fetch interactions from Sarvam API");
            err.status = resp.status;
            err.details = await resp.text();
            throw err;
        }

        const page = extractInteractions(await resp.json());
        if (!page.length) break;

        const fresh = page.filter((l) => l.interaction_id && !seen.has(l.interaction_id));
        if (!fresh.length) break; // nothing new: we have everything
        fresh.forEach((l) => seen.set(l.interaction_id, l));

        const times = page.map(logTime).filter(Number.isFinite);
        if (!times.length) break;

        if (!direction) {
            direction = logTime(page[0]) <= logTime(page[page.length - 1]) ? "asc" : "desc";
        }

        // Move the window past what we already have (1s overlap, duplicates are ignored)
        if (direction === "asc") from = Math.max(...times) - 1000;
        else to = Math.min(...times) + 1000;
    }

    return { logs: [...seen.values()], rounds, direction };
};

export const syncSarvamCallLogs = async (req, res) => {
    try {
        const cfg = await getActiveSarvamConfig();
        const apiKey = cfg.apiKey;
        const orgId = cfg.orgId;
        const workspaceId = cfg.workspaceId;
        const appId = cfg.appId;

        if (!apiKey || !orgId || !workspaceId || !appId) {
            return res.status(500).json({
                message: "Sarvam analytics configuration missing",
            });
        }

        // Which customer is the frontend asking about? (both optional)
        const customerId = req.query.customerId ? String(req.query.customerId) : "";
        const targetPhone = last10(req.query.phone);

        const baseUrl = `https://apps.sarvam.ai/api/analytics/v1/${orgId}/${workspaceId}/${appId}`;

        // Last 30 days
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 30);

        let all;
        try {
            all = await fetchAllInteractions(baseUrl, apiKey, start, end);
        } catch (e) {
            if (e.status) {
                return res.status(e.status).json({ message: e.message, details: e.details });
            }
            throw e;
        }

        let interactions = all.logs;
        const totalFromSarvam = interactions.length;

        // ---- ALL CALLS OF THIS CUSTOMER (before any transcript is fetched) ----
        // A call belongs to the customer when:
        //   1. its customer_id equals the selected customer, OR
        //   2. its phone equals the customer's phone AND the call has no
        //      customer_id, or carries a customer_id that no longer exists
        //      in our DB. (Calls tagged with ANOTHER existing customer stay
        //      with that customer; Amit and "test" share one phone number.)
        if (customerId || targetPhone) {
            const logCustIds = [...new Set(interactions.map(getLogCustomerId).filter(Boolean))];
            const existing = logCustIds.length
                ? await prisma.customer.findMany({
                    where: { id: { in: logCustIds } },
                    select: { id: true },
                })
                : [];
            const knownIds = new Set(existing.map((c) => c.id));

            interactions = interactions.filter((log) => {
                const logCustId = getLogCustomerId(log);

                if (customerId && logCustId === customerId) return true;

                if (targetPhone && (!logCustId || !knownIds.has(logCustId))) {
                    return last10(getLogPhone(log)) === targetPhone;
                }
                return false;
            });
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

        // ---- Sarvam vs our calculation: settles "whose fault is it" ----
        // dbCalls = calls OUR server started for this customer (saved at trigger time).
        // If dbCalls is bigger than matched, calls are missing from Sarvam's list
        // (or the filter drops them). newestFromSarvam shows how recent Sarvam's list reaches.
        const times = all.logs.map(logTime).filter(Number.isFinite);
        const dbCalls = customerId
            ? await prisma.sarvamCallLog.count({ where: { customerId } }).catch(() => null)
            : null;
        const meta = {
            fromSarvam: totalFromSarvam,
            sarvamRequests: all.rounds,
            order: all.direction,
            newestFromSarvam: times.length ? new Date(Math.max(...times)).toISOString() : null,
            oldestFromSarvam: times.length ? new Date(Math.min(...times)).toISOString() : null,
            matched: finalLogs.length,
            dbCalls,
            nowUtc: new Date().toISOString(),
        };
        console.log(`[sync] customer=${customerId || "-"} phone=${targetPhone || "-"}`, JSON.stringify(meta));

        return res.status(200).json({
            success: true,
            count: finalLogs.length,
            logs: finalLogs,
            meta,
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
        const cfg = await getActiveSarvamConfig();
        const apiKey = cfg.apiKey;
        const orgId = cfg.orgId;
        const workspaceId = cfg.workspaceId;
        const appId = cfg.appId;

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
// 4) Auth diagnostic (read-only): tries header/org-id combinations against the
//    Conversations gateway and reports which ones get past authentication.
//    Any status other than 401 means that combination passed auth.
// ---------------------------------------------------------------------------
export const sarvamAuthDiagnose = async (req, res) => {
    try {
        const cfg = await getActiveSarvamConfig();
        const key = cfg.apiKey;
        const workspaceId = cfg.workspaceId;

        if (!key || !workspaceId) {
            return res.status(500).json({ message: "SARVAM_API_KEY or SARVAM_WORKSPACE_ID not loaded" });
        }

        // Org IDs to try: the one from .env/DB, plus the short id embedded in the key (sk_<orgId>_...)
        const keyOrgId = key.split("_")[1];
        const orgIds = [...new Set([cfg.orgId, keyOrgId].filter(Boolean))];

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










// sarvam call report 
const summaryCache = new Map();

export const getSarvamCallReport = async (req, res) => {
    try {
        // ---------------------------------------------------------
        // 0. Settings
        // ---------------------------------------------------------
        const IST_OFFSET_MIN = 330;
        const DEFAULT_RANGE_DAYS = 30;
        const MAX_RANGE_DAYS = 366;
        const DEFAULT_PAGE_SIZE = 20;
        const MAX_PAGE_SIZE = 100;
        const SUMMARY_PAGE_SIZE = 200;
        const SUMMARY_MAX_PAGES = 100;
        const SUMMARY_CACHE_TTL_MS = 60 * 1000;
        const SHORT_CALL_MAX_MESSAGES = 1;
        // Changed to Math.ceil so calls under 30s don't become 0 billable minutes
        const BILLABLE_ROUNDING = Math.ceil;
        const MEDIA_HOST = "indus.sarvam.ai";

        // ---------------------------------------------------------
        // 1. Sarvam config
        // ---------------------------------------------------------
        const cfg = await getActiveSarvamConfig();
        const { apiKey, orgId, workspaceId, appId } = cfg;

        if (!apiKey || !orgId || !workspaceId || !appId) {
            return res.status(500).json({ message: "Sarvam analytics configuration missing" });
        }

        const attemptsUrl = `https://apps.sarvam.ai/api/analytics/v1/${orgId}/${workspaceId}/${appId}/attempts`;
        // baseUrl required for fetching individual transcripts, same as sync controller
        const baseUrl = `https://apps.sarvam.ai/api/analytics/v1/${orgId}/${workspaceId}/${appId}`;

        // ---------------------------------------------------------
        // 2. Read + validate the query string
        // ---------------------------------------------------------
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE));
        const status = ["all", "answered", "not_answered"].includes(req.query.status) ? req.query.status : "all";
        const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";
        const refresh = req.query.refresh === "true";

        const dateRe = /^\d{4}-\d{2}-\d{2}$/;
        const todayIst = new Date(Date.now() + IST_OFFSET_MIN * 60000).toISOString().slice(0, 10);
        const endDate = dateRe.test(req.query.endDate) ? req.query.endDate : todayIst;
        const startDate = dateRe.test(req.query.startDate)
            ? req.query.startDate
            : new Date(Date.parse(`${endDate}T00:00:00Z`) - (DEFAULT_RANGE_DAYS - 1) * 86400000)
                .toISOString()
                .slice(0, 10);

        const startMs = Date.parse(`${startDate}T00:00:00Z`) - IST_OFFSET_MIN * 60000;
        const endMs = Date.parse(`${endDate}T00:00:00Z`) + 86400000 - 1 - IST_OFFSET_MIN * 60000;

        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
            return res.status(400).json({ message: "startDate and endDate must be real dates in YYYY-MM-DD format" });
        }
        if (startMs > endMs) return res.status(400).json({ message: "startDate must be on or before endDate" });
        if ((endMs - startMs) / 86400000 > MAX_RANGE_DAYS) return res.status(400).json({ message: `Date range cannot be longer than ${MAX_RANGE_DAYS} days` });

        const startIso = new Date(startMs).toISOString();
        const endIso = new Date(endMs).toISOString();

        // ---------------------------------------------------------
        // FIXED: Bulletproof credit rate parsing (prevents empty string == 0 bug)
        // ---------------------------------------------------------
        let creditRate = 4; // default
        const queryRate = req.query.creditsPerMinute;
        const envRate = process.env.SARVAM_CREDITS_PER_MINUTE;

        if (queryRate && !isNaN(Number(queryRate))) {
            creditRate = Number(queryRate);
        } else if (envRate && !isNaN(Number(envRate))) {
            creditRate = Number(envRate);
        }
        if (creditRate <= 0) creditRate = 4; // Safety net

        const billingResetMs = req.query.lastBillingDate ? Date.parse(req.query.lastBillingDate) : 0;

        // ---------------------------------------------------------
        // 3. THE TABLE
        // ---------------------------------------------------------
        const filterConditions = [];
        // FIX APPLIED HERE: Changed value: 0 to value: "0" because Sarvam strictly expects a string
        if (status === "answered") filterConditions.push({ id: "1", field: "duration_in_seconds", operator: "greater_than", value: "0" });
        else if (status === "not_answered") filterConditions.push({ id: "1", field: "duration_in_seconds", operator: "equals", value: "0" });

        const listParams = new URLSearchParams({
            start_datetime: startIso,
            end_datetime: endIso,
            limit: String(limit),
            offset: String((page - 1) * limit),
            sort_by: "start_datetime",
            sort_order: sortOrder,
        });
        if (filterConditions.length) listParams.set("filter_conditions", JSON.stringify(filterConditions));

        const listResp = await fetch(`${attemptsUrl}?${listParams.toString()}`, {
            method: "GET",
            headers: { "X-API-Key": apiKey, Accept: "application/json" },
            signal: AbortSignal.timeout(30000),
        });

        if (!listResp.ok) {
            const details = (await listResp.text()).slice(0, 500);
            console.error("[call-report] attempts list failed:", listResp.status, details);
            return res.status(listResp.status === 429 ? 429 : 502).json({
                message: "Failed to fetch call attempts from Sarvam",
                upstreamStatus: listResp.status,
                details,
            });
        }

        const listBody = await listResp.json();
        const items = Array.isArray(listBody?.items) ? listBody.items : [];
        const total = Number(listBody?.total) || 0;

        // ---------------------------------------------------------
        // 4. Transform Table Rows (Upgraded with concurrent Transcript fetching)
        // ---------------------------------------------------------
        const attemptIds = items.map((a) => a.attempt_id).filter(Boolean);
        const dbLogs = attemptIds.length
            ? await prisma.sarvamCallLog.findMany({
                where: { participantIdentity: { in: attemptIds } },
                select: { participantIdentity: true, customerId: true, calledTo: true },
            })
            : [];
        const dbByAttempt = new Map(dbLogs.map((l) => [l.participantIdentity, l]));

        const pageCustomerIds = new Set();
        for (const a of items) {
            const cid = dbByAttempt.get(a.attempt_id)?.customerId || a.agent_variables?.customer_id;
            if (cid) pageCustomerIds.add(String(cid));
        }
        const pageCustomers = pageCustomerIds.size
            ? await prisma.customer.findMany({
                where: { id: { in: [...pageCustomerIds] } },
                select: { id: true, customerName: true, ContactNumber: true, Campaign: true },
            })
            : [];
        const customerById = new Map(pageCustomers.map((c) => [c.id, c]));

        // Used Promise.all to fetch transcripts for the whole page concurrently without blocking
        const calls = await Promise.all(items.map(async (a) => {
            const sec = Number(a.duration_in_seconds) || 0;
            const answered = sec > 0;
            const billableMinutes = answered ? BILLABLE_ROUNDING(sec / 60) : 0;
            const callCredits = Number((billableMinutes * creditRate).toFixed(2));

            const dbLog = dbByAttempt.get(a.attempt_id);
            const cid = dbLog?.customerId || a.agent_variables?.customer_id;
            const customer = cid ? customerById.get(String(cid)) : null;

            const startRaw = String(a.start_datetime || "");
            const endRaw = String(a.end_datetime || "");
            const startParsed = startRaw ? Date.parse(/[zZ]$\vert{}[+-]\d\d:?\d\d$/.test(startRaw) ? startRaw : `${startRaw}Z`) : NaN;
            const endParsed = endRaw ? Date.parse(/[zZ]$\vert{}[+-]\d\d:?\d\d$/.test(endRaw) ? endRaw : `${endRaw}Z`) : NaN;

            let recordingUrl = null;
            if (typeof a.audio_url === "string" && a.audio_url && !a.audio_url.startsWith("data:")) {
                try { recordingUrl = new URL(a.audio_url, `https://${MEDIA_HOST}`).href; } catch { recordingUrl = null; }
            }

            // --- BEGIN TRANSCRIPT FETCHING LOGIC (Matching sync controller) ---
            let transcriptArray = [];
            if (Array.isArray(a.transcript)) {
                transcriptArray = a.transcript;
            } else if (a.transcript && Array.isArray(a.transcript.messages)) {
                transcriptArray = a.transcript.messages;
            }

            // Skip API calls if it clearly never connected
            const neverConnected = sec === 0 && !(a.num_messages > 0);
            if (!transcriptArray.length && !neverConnected && a.interaction_id) {
                try {
                    // Try inline function if available, fallback to manual fetch
                    if (typeof fetchInteractionTranscript === 'function') {
                        transcriptArray = await fetchInteractionTranscript(baseUrl, apiKey, a.interaction_id);
                    } else {
                        const trResp = await fetch(`${baseUrl}/interactions/${a.interaction_id}/transcript`, {
                            headers: { "X-API-Key": apiKey, Accept: "application/json" },
                            signal: AbortSignal.timeout(5000)
                        });
                        if (trResp.ok) {
                            const trBody = await trResp.json();
                            transcriptArray = Array.isArray(trBody) ? trBody : (trBody?.messages || []);
                        }
                    }
                } catch (e) {
                    console.warn(`[call-report] Failed to load transcript for ${a.interaction_id}`);
                }
            }
            // --- END TRANSCRIPT LOGIC ---

            return {
                attemptId: a.attempt_id || null,
                interactionId: a.interaction_id || null,
                customer: customer
                    ? { id: customer.id, name: customer.customerName, phone: customer.ContactNumber, campaign: customer.Campaign }
                    : (cid ? { id: String(cid), name: null, phone: null, campaign: null } : null),
                phone: dbLog?.calledTo || a.user_contact_masked || null,
                status: a.connectivity_status || (answered ? "connected" : "not_connected"),
                answered,
                failureReason: a.failure_reason || null,
                endedBy: a.ended_by || null,
                durationSeconds: sec,
                billableMinutes,
                credits: callCredits,
                startedAt: Number.isFinite(startParsed) ? new Date(startParsed).toISOString() : null,
                endedAt: Number.isFinite(endParsed) ? new Date(endParsed).toISOString() : null,
                language: a.language_name || null,
                numMessages: a.num_messages ?? 0,
                avgAgentLatencySeconds: a.average_agent_response_time_in_seconds ?? null,
                avgUserLatencySeconds: a.average_user_response_time_in_seconds ?? null,
                retryAttempt: a.retry_attempt ?? 0,
                channelDirection: a.channel_direction || null,
                channelProvider: a.channel_provider || null,
                channelType: a.channel_type || null,
                campaignId: a.campaign_id || null,
                isDebugCall: Boolean(a.is_debug_call),
                hasRecording: Boolean(recordingUrl),
                recordingUrl,
                summary: a.agent_variables?.call_summary || null,
                transcript: transcriptArray, // Exposing transcript in JSON response
            };
        }));

        // ---------------------------------------------------------
        // 5. THE TOTALS
        // ---------------------------------------------------------
        const cacheKey = [orgId, workspaceId, appId, startIso, endIso, billingResetMs].join("|");
        let agg = refresh ? null : summaryCache.get(cacheKey);
        if (agg && Date.now() - agg.at > SUMMARY_CACHE_TTL_MS) agg = null;
        const summaryFromCache = Boolean(agg);

        if (!agg) {
            const byStatus = new Map();
            const failureReasons = new Map();
            const endedByMap = new Map();
            const languages = new Map();
            const customersAgg = new Map();
            const dailyMap = new Map();
            const hourly = Array.from({ length: 24 }, () => ({ attempts: 0, connected: 0 }));

            const t = {
                attempts: 0, connected: 0, seconds: 0, billableMinutes: 0, longestSeconds: 0,
                messages: 0, shortCalls: 0, retries: 0, debugCalls: 0,
                agentLatencySum: 0, agentLatencyCount: 0, userLatencySum: 0, userLatencyCount: 0,
                billingCycleBillableMinutes: 0,
                billingCycleAnsweredCount: 0
            };

            let offset = 0;
            let sarvamTotal = 0;
            let requests = 0;

            while (requests < SUMMARY_MAX_PAGES) {
                const pageParams = new URLSearchParams({
                    start_datetime: startIso,
                    end_datetime: endIso,
                    limit: String(SUMMARY_PAGE_SIZE),
                    offset: String(offset),
                    sort_by: "start_datetime",
                    sort_order: "asc",
                });

                const r = await fetch(`${attemptsUrl}?${pageParams.toString()}`, {
                    method: "GET",
                    headers: { "X-API-Key": apiKey, Accept: "application/json" },
                    signal: AbortSignal.timeout(30000),
                });

                if (!r.ok) break;

                const body = await r.json();
                requests++;
                const rows = Array.isArray(body?.items) ? body.items : [];
                sarvamTotal = Number(body?.total) || sarvamTotal;

                for (const a of rows) {
                    const sec = Number(a.duration_in_seconds) || 0;
                    const connected = sec > 0;
                    const billable = connected ? BILLABLE_ROUNDING(sec / 60) : 0;

                    t.attempts++;

                    if (a.is_debug_call) t.debugCalls++;
                    if ((a.retry_attempt || 0) > 0) t.retries++;

                    const st = a.connectivity_status || (connected ? "connected" : "not_connected");
                    byStatus.set(st, (byStatus.get(st) || 0) + 1);
                    if (a.failure_reason) failureReasons.set(a.failure_reason, (failureReasons.get(a.failure_reason) || 0) + 1);

                    const raw = String(a.start_datetime || "");
                    const ms = raw ? Date.parse(/[zZ]$\vert{}[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`) : NaN;

                    if (Number.isFinite(ms)) {
                        const ist = new Date(ms + IST_OFFSET_MIN * 60000);
                        const day = ist.toISOString().slice(0, 10);

                        const d = dailyMap.get(day) || { attempts: 0, connected: 0, seconds: 0, billableMinutes: 0 };
                        d.attempts++;
                        if (connected) {
                            d.connected++;
                            d.seconds += sec;
                            d.billableMinutes += billable;
                        }
                        dailyMap.set(day, d);

                        const h = hourly[ist.getUTCHours()];
                        h.attempts++;
                        if (connected) h.connected++;
                    }

                    const cid = a.agent_variables?.customer_id ? String(a.agent_variables.customer_id) : "";
                    if (cid) {
                        const c = customersAgg.get(cid) || { attempts: 0, connected: 0, seconds: 0, billableMinutes: 0, fallbackPhone: null };
                        c.attempts++;
                        if (connected) {
                            c.connected++;
                            c.seconds += sec;
                            c.billableMinutes += billable;
                        }
                        if (!c.fallbackPhone && a.user_contact_masked) {
                            c.fallbackPhone = a.user_contact_masked;
                        }
                        customersAgg.set(cid, c);
                    }

                    if (connected) {
                        t.connected++;
                        t.seconds += sec;
                        t.billableMinutes += billable;

                        if (Number.isFinite(ms) && ms >= billingResetMs) {
                            t.billingCycleBillableMinutes += billable;
                            t.billingCycleAnsweredCount++;
                        }

                        if (sec > t.longestSeconds) t.longestSeconds = sec;
                        t.messages += Number(a.num_messages) || 0;
                        if ((Number(a.num_messages) || 0) <= SHORT_CALL_MAX_MESSAGES) t.shortCalls++;

                        const by = a.ended_by || "UNKNOWN";
                        endedByMap.set(by, (endedByMap.get(by) || 0) + 1);
                        const lang = a.language_name || "Unknown";
                        languages.set(lang, (languages.get(lang) || 0) + 1);

                        if (a.average_agent_response_time_in_seconds != null) {
                            t.agentLatencySum += Number(a.average_agent_response_time_in_seconds) || 0;
                            t.agentLatencyCount++;
                        }
                        if (a.average_user_response_time_in_seconds != null) {
                            t.userLatencySum += Number(a.average_user_response_time_in_seconds) || 0;
                            t.userLatencyCount++;
                        }
                    }
                }

                offset += rows.length;
                if (!rows.length || offset >= sarvamTotal) break;
            }

            agg = {
                at: Date.now(),
                requests,
                truncated: offset < sarvamTotal,
                countedAttempts: t.attempts,
                t, dailyMap, hourly,
                byStatus: [...byStatus.entries()].sort((x, y) => y[1] - x[1]).map(([name, count]) => ({ name, count })),
                failureReasons: [...failureReasons.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([name, count]) => ({ name, count })),
                endedBy: [...endedByMap.entries()].sort((x, y) => y[1] - x[1]).map(([name, count]) => ({ name, count })),
                languages: [...languages.entries()].sort((x, y) => y[1] - x[1]).map(([name, count]) => ({ name, count })),
                topCustomerRows: [...customersAgg.entries()]
                    .sort((x, y) => y[1].billableMinutes - x[1].billableMinutes || y[1].attempts - x[1].attempts)
                    .slice(0, 10)
                    .map(([customerId, c]) => ({ customerId, ...c })),
            };

            summaryCache.set(cacheKey, agg);
            if (summaryCache.size > 50) summaryCache.delete(summaryCache.keys().next().value);
        }

        // ---------------------------------------------------------
        // 6. Shape the totals for the frontend
        // ---------------------------------------------------------
        const t = agg.t;
        const notAnswered = t.attempts - t.connected;

        const cycleBillableMinutes = billingResetMs ? t.billingCycleBillableMinutes : t.billableMinutes;
        const cycleAnswered = billingResetMs ? t.billingCycleAnsweredCount : t.connected;

        const summary = {
            totalCalls: t.attempts,
            answered: t.connected,
            notAnswered,
            pickupRate: t.attempts ? Number(((t.connected / t.attempts) * 100).toFixed(1)) : 0,
            totalTalkSeconds: Math.round(t.seconds),
            avgCallSeconds: t.connected ? Math.round(t.seconds / t.connected) : 0,
            longestCallSeconds: Math.round(t.longestSeconds),
            billableMinutes: t.billableMinutes,
            creditsUsed: Number((cycleBillableMinutes * creditRate).toFixed(2)),
            avgCreditsPerAnsweredCall: cycleAnswered ? Number(((cycleBillableMinutes * creditRate) / cycleAnswered).toFixed(2)) : 0,
            avgMessagesPerAnsweredCall: t.connected ? Number((t.messages / t.connected).toFixed(1)) : 0,
            shortCalls: t.shortCalls,
            shortCallRate: t.connected ? Number(((t.shortCalls / t.connected) * 100).toFixed(1)) : 0,
            retriedAttempts: t.retries,
            debugCalls: t.debugCalls,
            avgAgentLatencySeconds: t.agentLatencyCount ? Number((t.agentLatencySum / t.agentLatencyCount).toFixed(2)) : null,
            avgUserLatencySeconds: t.userLatencyCount ? Number((t.userLatencySum / t.userLatencyCount).toFixed(2)) : null,
        };

        const daily = [];
        for (let ts = Date.parse(`${startDate}T00:00:00Z`); ts <= Date.parse(`${endDate}T00:00:00Z`); ts += 86400000) {
            const date = new Date(ts).toISOString().slice(0, 10);
            const d = agg.dailyMap.get(date) || { attempts: 0, connected: 0, seconds: 0, billableMinutes: 0 };
            daily.push({
                date, attempts: d.attempts, answered: d.connected, notAnswered: d.attempts - d.connected,
                talkSeconds: Math.round(d.seconds), billableMinutes: d.billableMinutes,
                credits: Number((d.billableMinutes * creditRate).toFixed(2)),
            });
        }

        const hourly = agg.hourly.map((h, hour) => ({
            hour, label: `${String(hour).padStart(2, "0")}:00`, attempts: h.attempts, answered: h.connected,
            pickupRate: h.attempts ? Number(((h.connected / h.attempts) * 100).toFixed(1)) : 0,
        }));

        const topIds = agg.topCustomerRows.map((c) => c.customerId);
        const topCustomerDocs = topIds.length
            ? await prisma.customer.findMany({ where: { id: { in: topIds } }, select: { id: true, customerName: true, ContactNumber: true } })
            : [];
        const topNameById = new Map(topCustomerDocs.map((c) => [c.id, c]));

        const topCustomers = agg.topCustomerRows.map((c) => ({
            customerId: c.customerId,
            name: topNameById.get(c.customerId)?.customerName || "Unknown",
            phone: topNameById.get(c.customerId)?.ContactNumber || c.fallbackPhone || "Unknown",
            calls: c.attempts,
            answered: c.connected,
            talkSeconds: Math.round(c.seconds),
            billableMinutes: c.billableMinutes,
            credits: Number((c.billableMinutes * creditRate).toFixed(2)),
        }));

        const totalPages = Math.max(1, Math.ceil(total / limit));

        return res.status(200).json({
            success: true,
            totalCreditsLeft: null,
            filters: { startDate, endDate, timezone: "Asia/Kolkata", status, sortOrder },
            pagination: { page, limit, total, totalPages, hasNext: (page - 1) * limit + items.length < total, hasPrev: page > 1 },
            summary, daily, hourly,
            breakdowns: { status: agg.byStatus, failureReasons: agg.failureReasons, endedBy: agg.endedBy, languages: agg.languages },
            topCustomers, calls,
            meta: {
                summaryFromCache, summarySarvamRequests: agg.requests, summaryTruncated: agg.truncated,
                creditsNote: billingResetMs
                    ? `Showing credits used strictly AFTER your last recharge date.`
                    : `Pass ?lastBillingDate= to reset the credit counter to 0 after a top-up.`,
                generatedAt: new Date().toISOString(),
            },
        });
    } catch (error) {
        console.error("Sarvam call report failed:", error);
        return res.status(500).json({ message: "Internal server error building call report", error: error.message });
    }
};




