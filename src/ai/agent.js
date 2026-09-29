
import { getDynamicAIContext } from "../config/aiClientFactory.js";
import { BRAND } from "../config/brand.js";
import { gemini } from "../config/gemini.js";
import { openai } from "../config/openai.js";
import prisma from "../config/prismaClient.js";
import { fetchTabblyAgentPrompt } from "../controllers/controller.tabbly.js";
import { agentToolsDefinitions, agentToolsHandlers } from "../jobs/aiTools.js";
import { countSpokenWords } from "../jobs/ttsService.js";
import { buildCallingAgentSystemPrompt, callingAgentSystemPrompt } from "./prompts/callingAgentPrompt.js";
import { dataminingPrompt, miningDataPrompt } from "./prompts/dataminingAgentPrompt.js";
import { emailCampaignPrompt } from "./prompts/emailCampaignPrompt.js";
import { buildCustomerContext, buildHistoryContext, buildPrompt, followupPrompt } from "./prompts/followupPrompt.js";
import { keywordSearchPrompt } from "./prompts/keywordSearchPrompt.js";
import { propertyRecommendationPrompt } from "./prompts/propertyRecommendationPrompt.js";
import { qualifyCustomerPrompt } from "./prompts/qualifyCustomerPrompt.js";
import { scriptGenerationPrompt } from "./prompts/scriptGenerationPrompt.js";
import { socialAgentPrompt } from "./prompts/socialAgentPrompt.js";
import { aiTaskAgentPrompt, subtaskGenerationPrompt } from "./prompts/subtaskGenerationPrompt.js";
import { videoScriptGenerationPrompt } from "./prompts/VideoScriptGenerationPrompt.js";

export function safeJsonParse(raw) {
  if (!raw) return null;

  // 1. Remove ```json ... ``` or ``` ... ``` fences
  const cleaned = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // 2. Try standard parse first (Fast Path - preserves existing agent behavior)
  try {
    return JSON.parse(cleaned);
  } catch (firstErr) {
    // 3. Fallback Repair Path: Only executes if standard parse failed
    try {
      // Fix A: Remove rogue backslashes before non-JSON escape characters (e.g. \枉 -> 枉, \m -> m)
      // Valid JSON escapes: \", \\, \/, \b, \f, \n, \r, \t, \uXXXX
      let sanitized = cleaned.replace(/\\(?:[^"\\\/bfnrtu]|u(?![0-9a-fA-F]{4}))/g, (match) => {
        return match.slice(1); // Strip only the invalid backslash
      });

      // Fix B: Escape literal unescaped control characters / raw line breaks inside string values
      sanitized = sanitized.replace(/[\u0000-\u001F\u007F-\u009F]/g, (match) => {
        if (match === '\n') return '\\n';
        if (match === '\r') return '\\r';
        if (match === '\t') return '\\t';
        return '';
      });

      return JSON.parse(sanitized);
    } catch (secondErr) {
      console.warn("Failed to parse JSON:", cleaned);
      return null;
    }
  }
}

/**
 * HELPER: Routes the prompt to the correct SDK based on the active provider.
 * This prevents crashes when switching between Gemini, OpenAI, or future platforms.
 */
async function executeDynamicPrompt(client, model, provider, promptText) {
  if (provider === "OPENAI") {
    const response = await client.chat.completions.create({
      model: model,
      messages: [{ role: "user", content: promptText }],
      response_format: { type: "json_object" }, // Good practice if your prompt asks for JSON
      temperature: 0.2
    });
    return response.choices?.[0]?.message?.content;

  } else if (provider === "GEMINI") {
    const response = await client.models.generateContent({
      model: model,
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      config: {
        responseMimeType: "application/json", // Hard-enforces valid JSON syntax
        temperature: 0.2
      }
    });
    return response?.text;

  } else if (provider === "GROQ") {
    // Groq uses the exact same API structure as OpenAI!
    const response = await client.chat.completions.create({
      model: model,
      messages: [{ role: "user", content: promptText }],
      response_format: { type: "json_object" }, // Enforces JSON output from Llama models
      temperature: 0.2
    });
    return response.choices?.[0]?.message?.content;

  } else {
    // Ready for you to add ANTHROPIC, etc. later!
    throw new Error(`Unsupported AI Provider: ${provider}`);
  }
}

export async function keywordSearchAgent(userPrompt) {
  const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash");

  const promptText = `${keywordSearchPrompt}\n\nUser input:\n${userPrompt}`;
  const raw = await executeDynamicPrompt(client, model, provider, promptText);

  console.log(" naeruto ", safeJsonParse(raw))

  if (!raw || !raw.trim()) {
    throw new Error("AI returned empty response");
  }

  return safeJsonParse(raw);
}

export async function keywordSearchAgentOpenai(userPrompt) {
  const { client, model, provider } = await getDynamicAIContext("OPENAI", "openai/gpt-oss-120b:free");

  const promptText = `${keywordSearchPrompt}\n\nUser input:\n${userPrompt}`;
  const raw = await executeDynamicPrompt(client, model, provider, promptText);

  if (!raw || !raw.trim()) {
    throw new Error("AI returned empty response");
  }

  return safeJsonParse(raw);
}



// ─────────────────────Follow-up Agent Area───────────────────────────────────────

const STATUS = ["Interested", "Not Interested", "Callback Later", "No Response", "Converted", "Wrong Number"];
const DNC = ["Not Interested", "Wrong Number"];
const NEXT_DAYS = { Interested: 2, "Callback Later": 3, "No Response": 3 };

const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
};



/** Domains this specific customer's own links live on, so they don't get stripped. */
function customerDomains(c = {}) {
  const out = [];
  for (const u of [c.URL, c.GoogleMap, c.Video]) {
    try { if (u) out.push(new URL(u).hostname.replace(/^www\./, "").toLowerCase()); } catch { /* skip */ }
  }
  return out;
}


/**
 * @param {string} userPrompt   the rep's note
 * @param {object} opts { customer, history, language, channels }
 */
export async function followupAgent(userPrompt, opts = {}) {
  const {
    customer: rawCustomer = {},
    history: rawHistory = [],
    language = "hinglish",
    channels = { whatsapp: true, email: true },
  } = opts;

  const t = today();
  const customer = buildCustomerContext(rawCustomer);
  const history = buildHistoryContext(rawHistory);

  const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash");
  const raw = await executeDynamicPrompt(
    client, model, provider,
    `${buildPrompt(t, language, channels, customer, history)}\n\nUser input:\n${userPrompt}`
  );

  if (!raw || !raw.trim()) throw new Error("AI returned empty response");
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Invalid AI response format");
  const ai = safeJsonParse(match[0]);
  if (!ai) throw new Error("AI response was not parsable JSON");

  // ── repair the model instead of trusting it ──
  const d = ai.data || {};
  const StatusType = STATUS.find((s) => s.toLowerCase() === String(d.StatusType || "").trim().toLowerCase()) || "No Response";

  let FollowupNextDate = null;
  if (!DNC.includes(StatusType) && StatusType !== "Converted") {
    const v = d.FollowupNextDate;
    FollowupNextDate = /^\d{4}-\d{2}-\d{2}$/.test(v || "") && v > t ? v : addDays(t, NEXT_DAYS[StatusType] || 2);
  }

  const blocked = DNC.includes(StatusType);
  const allowed = [hostOf(BRAND.website), ...customerDomains(rawCustomer)].filter(Boolean);

  return {
    data: {
      StartDate: t,
      StatusType,
      FollowupNextDate,
      Description: String(d.Description || "").trim() || `Interaction logged as ${StatusType}.`,
    },
    whatsapp: blocked || !channels.whatsapp ? null : cleanWa(ai.whatsapp, allowed),
    email:
      blocked || !channels.email || !ai.email?.subject || !ai.email?.body
        ? null
        : {
          subject: String(ai.email.subject).trim().slice(0, 120),
          body: cleanHtml(ai.email.body, allowed) + emailSignature(),
        },
    message: String(ai.message || "").trim() || "Review the follow-up.",
  };
}

/* ── helpers ── */
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;

const isAllowed = (url, allowed) => {
  const h = hostOf(url);
  return !!h && allowed.some((d) => h === d || h.endsWith(`.${d}`));
};

function cleanWa(text, allowed) {
  if (!text) return null;
  let out = String(text)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Kill any URL the model invented — a 404 in front of a customer is worse than no link.
  out = out.replace(URL_RE, (u) => (isAllowed(u, allowed) ? u : "")).replace(/ {2,}/g, " ").trim();
  // A leftover {{Token}} means personalisation failed — don't ship it.
  out = out.replace(/\{\{\s*[\w.]+\s*\}\}/g, "").trim();
  return out ? `${out}\n\n— ${BRAND.signAs}\n${BRAND.website.replace(/^https?:\/\//, "")}` : null;
}

function cleanHtml(html, allowed) {
  let out = String(html)
    .replace(/<\s*(script|style|iframe|link|meta)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\/?(html|head|body)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*(".*?"|'.*?')/gi, "");
  out = out.replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (full, href, label) => (isAllowed(href, allowed) ? full : label));
  return out.replace(/\{\{\s*[\w.]+\s*\}\}/g, "").trim();
}

function emailSignature() {
  return `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e5;font-family:Arial,sans-serif;font-size:13px;color:#555;">
<strong style="color:#222;">${BRAND.signAs}</strong><br>
<a href="${BRAND.website}" style="color:#555;">${BRAND.website}</a><br>
${BRAND.phone ? `${BRAND.phone}<br>` : ""}<a href="mailto:${BRAND.email}" style="color:#555;">${BRAND.email}</a>
</div>`;
}

export async function QualifyAgent(userPrompt) {
  const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash");

  console.log(" naruto is here ", " client", client, "model", model)

  const promptText = `${qualifyCustomerPrompt}\nDATA:\n${JSON.stringify(userPrompt, null, 2)}`;
  const raw = await executeDynamicPrompt(client, model, provider, promptText);

  console.log(" raw ", raw)

  if (!raw || !raw.trim()) {
    throw new Error("AI returned empty response");
  }

  // Extract JSON safely
  const jsonMatch = raw.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error("Invalid AI response format");
  }

  return safeJsonParse(jsonMatch[0]);
}

export async function CallingAgent(userPrompt) {
  const basePrompt = await fetchTabblyAgentPrompt();
  const systemPrompt = buildCallingAgentSystemPrompt(basePrompt);

  const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash-lite");

  const promptText = `${systemPrompt}\nDATA:\n${JSON.stringify(userPrompt, null, 2)}`;
  const raw = await executeDynamicPrompt(client, model, provider, promptText);

  //console.log(" raw ", raw)

  if (!raw || !raw.trim()) {
    throw new Error("AI returned empty response");
  }

  // Extract JSON safely
  const jsonMatch = raw.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error("Invalid AI response format");
  }

  return safeJsonParse(jsonMatch[0]);
}

export async function PropertyRecommendationAgent(userPrompt) {
  const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash-lite");

  const promptText = `${propertyRecommendationPrompt}\nDATA:\n${JSON.stringify(userPrompt, null, 2)}`;
  const raw = await executeDynamicPrompt(client, model, provider, promptText);

  //console.log(" raw ", raw)

  if (!raw || !raw.trim()) {
    throw new Error("AI returned empty response");
  }

  // Extract JSON safely
  const jsonMatch = raw.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error("Invalid AI response format");
  }

  return safeJsonParse(jsonMatch[0]);
}

export async function DataMiningAgent(data) {
  const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash-lite");

  const promptText = `\n${dataminingPrompt}\nDATA:\n${JSON.stringify(data, null, 2)}\n`;
  const raw = await executeDynamicPrompt(client, model, provider, promptText);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Invalid AI response");

  return JSON.parse(jsonMatch[0]);
}

export async function MiningDataAgent(userPrompt) {
  const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash-lite");

  const promptText = `${miningDataPrompt}\nDATA:\n${JSON.stringify(userPrompt, null, 2)}`;
  const raw = await executeDynamicPrompt(client, model, provider, promptText);

  console.log(" raw ", raw)

  if (!raw || !raw.trim()) {
    throw new Error("AI returned empty response");
  }

  // Extract JSON safely
  const jsonMatch = raw.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error("Invalid AI response format");
  }

  return safeJsonParse(jsonMatch[0]);
}

// Added 'mode' as the third parameter with a default value
export async function ScriptGenerationAgent(userPrompt, customerContext = {}, mode = "hindi") {
  // Construct the payload dynamically
  const payload = {
    userPrompt: userPrompt,
    mode: mode, // Provide the mode to the AI so it knows which language to output
    // Only include customer/followups if they exist in the context
    ...(customerContext.customer && { customer: customerContext.customer }),
    ...(customerContext.followups && { followups: customerContext.followups }),
  };

  const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash-lite");

  const promptText = `${scriptGenerationPrompt}\nDATA:\n${JSON.stringify(payload, null, 2)}`;
  const raw = await executeDynamicPrompt(client, model, provider, promptText);

  if (!raw || !raw.trim()) {
    throw new Error("AI returned empty response");
  }

  // Extract JSON safely
  const jsonMatch = raw.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error("Invalid AI response format");
  }

  // Assuming safeJsonParse is a utility function you have defined elsewhere
  return safeJsonParse(jsonMatch[0]);
}

export async function followupAgentOpenai(userPrompt) {
  const { client, model, provider } = await getDynamicAIContext("OPENAI", "openai/gpt-4o-mini");

  const promptText = `${followupPrompt}\n\nUser input:\n${userPrompt}`;
  const raw = await executeDynamicPrompt(client, model, provider, promptText);

  if (!raw || !raw.trim()) {
    throw new Error("AI returned empty response");
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error("Invalid AI response format");
  }

  return safeJsonParse(jsonMatch[0]);
}

export async function SocialContentAgent(payload) {
  const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash-lite");

  const promptText = `\n${socialAgentPrompt}\nDATA:\n${JSON.stringify(payload, null, 2)}\n`;
  const raw = await executeDynamicPrompt(client, model, provider, promptText);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Invalid AI response");

  return JSON.parse(jsonMatch[0]);
}


// Drop-in replacement for EmailCampaignAgent.
// Only change: a 4th optional `templateHtml` param, forwarded into the
// payload the prompt sees as DATA.templateHtml. See emailCampaignPrompt.js
// for the matching instruction that tells the model how to use it.

export async function EmailCampaignAgent(userPrompt, customerContext = {}, mode = "hindi") {
  const payload = {
    userPrompt,
    mode,
    ...(customerContext.customer && { customer: customerContext.customer }),
  };

  const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash");
  const promptText = `${emailCampaignPrompt}\nDATA:\n${JSON.stringify(payload, null, 2)}`;
  const raw = await executeDynamicPrompt(client, model, provider, promptText);

  if (!raw || !raw.trim()) throw new Error("AI returned empty response");
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Invalid AI response format");
  return safeJsonParse(jsonMatch[0]);
}


// webhook integrated agent 

/**
 * Fully Dynamic Webhook Agent
 * Handles custom methods, headers, and merges static API keys with AI-generated payloads.
 */
// ── URL template helpers ──────────────────────────────────────────────
// Pulls the templated parts out of a URL string so the AI can fill them
// the same way it fills the body: path params (":id") and query params
// whose current value is just a placeholder/example (e.g. "?catalog=mango").
function parseUrlTemplate(rawUrl) {
  const [pathPart, queryPart] = rawUrl.split("?");

  const pathParams = {};
  const pathParamNames = pathPart.match(/:([a-zA-Z0-9_]+)/g) || [];
  pathParamNames.forEach((token) => {
    pathParams[token.slice(1)] = ""; // empty placeholder, same convention as body fields
  });

  const queryParams = {};
  if (queryPart) {
    new URLSearchParams(queryPart).forEach((value, key) => {
      queryParams[key] = value; // existing value treated as an example/placeholder to refine
    });
  }

  return { pathTemplate: pathPart, pathParams, queryParams };
}

function buildFinalUrl(pathTemplate, pathParams = {}, queryParams = {}) {
  let finalPath = pathTemplate;
  for (const [key, value] of Object.entries(pathParams)) {
    finalPath = finalPath.replace(`:${key}`, encodeURIComponent(value ?? ""));
  }

  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null && value !== "") qs.set(key, value);
  }
  const qsString = qs.toString();
  return qsString ? `${finalPath}?${qsString}` : finalPath;
}

export async function WebhookIntegratedAgent(userPrompt, webhookConfig = {}) {
  const {
    url,
    method = "POST",
    headers = { "Content-Type": "application/json" },
    basePayload = {},
    customPrompt = "Analyze the data and generate a valid JSON payload.",
  } = webhookConfig;

  const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash");

  // Break the configured URL into its templated pieces (path params, query
  // params) so they can be resolved by the AI exactly like body fields are.
  const { pathTemplate, pathParams, queryParams } = url ? parseUrlTemplate(url) : {};

  // Combine URL pieces and body into one TEMPLATE structure. Sections with
  // nothing to fill are omitted so the prompt doesn't carry empty noise.
  const combinedTemplate = {
    ...(pathParams && Object.keys(pathParams).length ? { urlPathParams: pathParams } : {}),
    ...(queryParams && Object.keys(queryParams).length ? { urlQueryParams: queryParams } : {}),
    ...(Object.keys(basePayload).length ? { body: basePayload } : {}),
  };

  const promptText = `
${customPrompt}

You will be given TEMPLATE, a JSON object describing every place real values are needed for this
request, and DATA, the real information available (which may include a customer record, a raw
user instruction, timestamps, or other context).

TEMPLATE may contain any of these top-level sections — only the ones present apply:
- "urlPathParams": values that get substituted into the request URL's path (e.g. a route like
  "/thing/:id" needs the real id here).
- "urlQueryParams": values that get appended to the request URL's query string. Their current
  value is only an example/placeholder of the expected format, not a literal default.
- "body": the JSON body sent to the webhook, in whatever shape it needs to be.

Your job: return a single JSON object with EXACTLY the same top-level sections and the same nested
keys as TEMPLATE, with every value replaced by the correct real value drawn from DATA.

Rules for filling any placeholder, in any section, regardless of key names:
- Infer each key's intent from its name and from the shape/type of its placeholder value (empty
  string, empty array, empty object, 0, false, or an example value — these are all placeholders to
  be replaced, not values to keep).
- Match each key to the most semantically relevant field(s) in DATA. Use your judgment the way a
  competent integration engineer would — you are not limited to exact name matches.
- Preserve the exact type of each placeholder (string stays string, array stays array, object
  stays object, number stays number, boolean stays boolean) unless DATA makes it clear the value
  should be a specific literal.
- Values destined for a URL (urlPathParams, urlQueryParams) must be simple strings or numbers —
  never an object or array — since they get inserted directly into a URL.
- If a key's placeholder looks like free text (an instruction, note, prompt, or message field), you
  may lightly clean up or rephrase the relevant DATA text for clarity — but never invent facts that
  aren't in DATA.
- If TEMPLATE has a key you cannot confidently map to anything in DATA, keep its original
  placeholder value rather than guessing.
- Never add keys/sections that aren't in TEMPLATE, and never omit one that is.

Return ONLY the filled JSON object. No markdown fences, no explanation, no commentary.

TEMPLATE:
${JSON.stringify(combinedTemplate, null, 2)}

DATA:
${JSON.stringify(userPrompt, null, 2)}
  `;

  const raw = await executeDynamicPrompt(client, model, provider, promptText);
  if (!raw || !raw.trim()) throw new Error("AI returned empty response");

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Invalid AI response format");

  const filled = safeJsonParse(jsonMatch[0]);

  // aiData for display purposes stays focused on the body — that's the
  // part meant to be read as "what the agent extracted/decided".
  const aiPayload = filled?.body ?? filled ?? {};
  let finalResult = { aiData: aiPayload };

  if (url) {
    try {
      const finalUrl = buildFinalUrl(
        pathTemplate,
        filled?.urlPathParams ?? pathParams,
        filled?.urlQueryParams ?? queryParams
      );

      const fetchOptions = { method: method.toUpperCase(), headers };

      if (!["GET", "HEAD"].includes(fetchOptions.method)) {
        const finalBody = { ...basePayload, ...aiPayload };
        fetchOptions.body = JSON.stringify(finalBody);
      }

      const response = await fetch(finalUrl, fetchOptions);
      const responseData = await response.json().catch(() => null);
      finalResult.webhookResponse = { status: response.status, ok: response.ok, data: responseData };
    } catch (webhookError) {
      finalResult.webhookError = webhookError.message;
    }
  }

  return finalResult;
}


export async function productPriceCompareAgent(productName, products) {
  if (!products || products.length === 0) return "";
  const cheapest = products[0];
  const fallback = `The lowest price found for ${productName} is ${cheapest.price} on ${cheapest.platform}.`;

  try {
    // Dynamically pull your Master Key from Prisma just like your Sales Script agent
    const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash-lite");

    const resultsText = products.map(p => `${p.platform}: ${p.price}`).join("\n");
    const promptText = `Product: ${productName}\nPrices:\n${resultsText}\nWrite exactly two short sentences. Mention the cheapest platform and price, and the total number of platforms found. Do not use markdown.`;

    const raw = await executeDynamicPrompt(client, model, provider, promptText);
    console.log(" output raw", raw)
    return raw ? raw.trim() : fallback;

  } catch (error) {
    console.error("AI Summary error:", error.message);
    return fallback; // Safe failover if the database AI key logic fails
  }
}


// agents/videoScriptGenerationAgent.js



const MIN_WORDS = 12;
const MAX_WORDS = 18;
const MAX_ATTEMPTS = 4;

function cleanLine(line) {
  let sentence = String(line).replace(/[,;:।.!?\n]+/g, " ");
  sentence = sentence.replace(/\s+/g, " ").trim();
  sentence = sentence.replace(/^[-\u2014\s]+|[-\u2014\s]+$/g, "");
  return sentence;
}

/**
 * Generates one voiceover line per photo.
 *
 * @param {string[]} photoLabels - ordered area labels, one per photo (e.g. ["front area", "hall", "kitchen"])
 * @param {string} propertyDetails - free text property description
 * @param {string} [mode] - language/tone, e.g. "hinglish" | "hindi" | "english"
 */
export async function VideoScriptGenerationAgent(photoLabels, propertyDetails, mode = "hinglish") {
  if (!Array.isArray(photoLabels) || photoLabels.length === 0) {
    throw new Error("At least one photo label is required");
  }
  if (!propertyDetails || !propertyDetails.trim()) {
    throw new Error("Property details are required");
  }

  const photoOrder = photoLabels.map((label, i) => `Photo ${i + 1}: ${label}`).join("\n");

  const payload = {
    propertyDetails: propertyDetails.trim(),
    totalPhotos: photoLabels.length,
    photoOrder,
    mode,
  };

  const { client, model, provider } = await getDynamicAIContext("GROQ", "llama-3.3-70b-versatile");

  let lastError = "Voiceover generation failed.";
  const MAX_ATTEMPTS = 4; // Ensure you have this defined

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      // Feed the specific error back to the AI so it knows exactly what to fix
      const retryNote =
        attempt > 0
          ? `\nPREVIOUS ERROR: ${lastError}\nPlease fix this. Ensure word counts are strictly 14-16 words per line, keep exact photo order, and strictly follow the alphabet rules for the requested mode.`
          : "";

      const promptText = `${videoScriptGenerationPrompt}\nDATA:\n${JSON.stringify(payload, null, 2)}${retryNote}`;

      const raw = await executeDynamicPrompt(client, model, provider, promptText);

      if (!raw || !raw.trim()) {
        throw new Error("AI returned empty response");
      }

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Invalid AI response format");
      }

      const data = safeJsonParse(jsonMatch[0]);
      const lines = data?.voiceovers;

      if (!Array.isArray(lines) || lines.length !== photoLabels.length) {
        throw new Error(`Expected ${photoLabels.length} lines but received ${lines?.length ?? 0}`);
      }

      const cleaned = [];
      const invalidLengths = [];
      let languageError = null;

      // Regex to detect Hindi Devanagari characters
      const hasDevanagari = (text) => /[\u0900-\u097F]/.test(text);
      const normalizedMode = mode.toLowerCase();

      lines.forEach((line, idx) => {
        const sentence = cleanLine(line); // Assuming cleanLine is defined in your file
        if (!sentence) {
          throw new Error(`Photo ${idx + 1} voiceover is empty`);
        }

        // 1. Language Validation Check
        if (normalizedMode === "hinglish" || normalizedMode === "english") {
          if (hasDevanagari(sentence)) {
            languageError = `Mode is ${mode}, but Devanagari script was detected in line ${idx + 1}. You MUST use ONLY the Latin alphabet (A-Z).`;
          }
        } else if (normalizedMode === "hindi") {
          if (!hasDevanagari(sentence)) {
            languageError = `Mode is hindi, but no Devanagari script was found in line ${idx + 1}. You MUST use Devanagari alphabet.`;
          }
        }

        // 2. Length Validation Check
        const wordCount = countSpokenWords(sentence);
        if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) {
          invalidLengths.push({ photo: idx + 1, words: wordCount });
        }

        cleaned.push(sentence);
      });

      // Throw language errors immediately to trigger a retry with the specific instruction
      if (languageError && attempt < MAX_ATTEMPTS - 1) {
        throw new Error(languageError);
      }

      // Small tolerance keeps generation reliable - final audio duration is
      // still fitted exactly to each photo slot later via ffmpeg atempo.
      if (invalidLengths.length && attempt < MAX_ATTEMPTS - 1) {
        throw new Error(`Voiceover word counts out of range: ${JSON.stringify(invalidLengths)}`);
      }

      return {
        voiceovers: cleaned,
        metadata: { attempts: attempt + 1, mode },
      };
    } catch (error) {
      lastError = error.message;
    }
  }

  throw new Error(lastError);
}


// 🚨 FIXED: Added clientContext to signature
export async function SubtaskGenerationAgent(taskTitle, taskDescription = "", employeeContext = {}, clientContext = {}) {
  // Construct the payload dynamically
  const payload = {
    taskTitle,
    taskDescription,
    ...(Object.keys(employeeContext).length > 0 && { employee: employeeContext }),
    ...(Object.keys(clientContext).length > 0 && { clientProject: clientContext }), // 🚨 ADDED
  };

  const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash");

  const promptText = `${subtaskGenerationPrompt}\nDATA:\n${JSON.stringify(payload, null, 2)}`;
  const raw = await executeDynamicPrompt(client, model, provider, promptText);

  if (!raw || !raw.trim()) throw new Error("AI returned empty response");

  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Invalid AI response format. Expected a JSON array.");

  return safeJsonParse(jsonMatch[0]);
}

function normalizeExecutionSummary(raw) {
  const empty = { overview: "", rationale: [], highlights: [], objectives: [] };
  if (!raw) return empty;

  if (typeof raw === "string") {
    const lines = raw
      .split(/\n+/)
      .map((l) => l.replace(/^[-•\s]+/, "").trim())
      .filter(Boolean);
    return {
      overview: lines[0] || "",
      rationale: lines.slice(1),
      highlights: [],
      objectives: [],
    };
  }

  if (typeof raw === "object") {
    return {
      overview: typeof raw.overview === "string" ? raw.overview : "",
      rationale: Array.isArray(raw.rationale) ? raw.rationale.filter(Boolean) : [],
      highlights: Array.isArray(raw.highlights) ? raw.highlights.filter(Boolean) : [],
      objectives: Array.isArray(raw.objectives) ? raw.objectives.filter(Boolean) : [],
    };
  }

  return empty;
}

// 🚨 FIXED: Added clientContext to signature
export async function TaskGenerationAgent(adminPrompt, employeeContext = {}, clientContext = {}) {
  const payload = {
    adminPrompt,
    employee: employeeContext,
    clientProject: clientContext // 🚨 ADDED
  };
  const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash");

  const raw = await executeDynamicPrompt(client, model, provider, `${aiTaskAgentPrompt}\nDATA:\n${JSON.stringify(payload)}`);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Invalid AI response format.");

  const parsed = safeJsonParse(jsonMatch[0]);
  return {
    ...parsed,
    executionSummary: normalizeExecutionSummary(parsed.executionSummary),
  };
}


// ---------------------------------------------------------
// AGENT 1: MICRO-QA (Subtask Verification)
// ---------------------------------------------------------
export async function SubTaskVerificationAgent(subTask, submittedProof, systemCheck) {
  const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash");

  const prompt = `
    You are a reasonable and context-aware QA Engineering Manager evaluating a single step of a workflow.
    
    SUBTASK TITLE: "${subTask.title}"
    ADMIN INSTRUCTIONS: "${subTask.description || 'None provided'}"
    EXPECTED PROOF DEFINITION: "${subTask.expectedProof || 'Any valid evidence, link, or detailed textual explanation'}"
    
    EMPLOYEE SUBMISSION: "${submittedProof}"
    SYSTEM AUTOMATED CHECK: "${systemCheck}"
    
    RULES:
    1. Evaluate if the Employee Submission reasonably fulfills the Subtask Title and Instructions.
    2. ACCEPT DETAILED TEXT: If the employee cannot provide a link but provides specific, credible context (e.g., naming tools like Dribbble/Figma, explaining a design choice, detailing a local setup, or explaining a system limitation), ACCEPT IT as valid proof.
    3. REJECT ONLY IF:
       - The submission is entirely lazy or vague (e.g., "done", "I did it", "ok") with zero context.
       - The "Expected Proof Definition" explicitly demands a specific URL format, and the employee completely ignored it without a valid technical excuse.
    4. If the System Automated Check reports a hard failure on a provided URL (e.g., 404), reject it.
    
    Respond ONLY with a valid JSON object in this exact format:
    {
      "isVerified": boolean,
      "feedback": "string (Short, encouraging feedback if approved. If rejected, explain exactly what specific detail or artifact is missing)"
    }
  `;

  const raw = await executeDynamicPrompt(client, model, provider, prompt);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Invalid AI response format.");

  return safeJsonParse(jsonMatch[0]);
}

// ---------------------------------------------------------
// AGENT 2: MACRO-QA (Final Task Gatekeeper)
// ---------------------------------------------------------
export async function TaskMacroReviewAgent(taskData) {
  const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash");

  const prompt = `
    You are a strict QA Executive Manager reviewing a completed task.
    All individual subtasks have been verified, but you must evaluate the overall execution.
    
    TASK OBJECTIVE: "${taskData.title}"
    ADMIN INSTRUCTIONS: "${taskData.description || 'None'}"
    
    SUBTASKS COMPLETED:
    ${JSON.stringify(taskData.subTasks.map(st => ({
    title: st.title,
    proof: st.submittedProof
  })))}
    
    RULES:
    1. Does the combined execution of these subtasks successfully fulfill the main Task Objective?
    2. Is there anything highly subjective that requires a human admin to verify? (Set requiresHumanQA to true if so).
    
    Respond ONLY with a valid JSON object in this exact format:
    {
      "approved": boolean,
      "score": number (0 to 100),
      "summary": "string (Executive summary for the Admin detailing how the task was executed)",
      "requiresHumanQA": boolean
    }
  `;

  const raw = await executeDynamicPrompt(client, model, provider, prompt);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Invalid AI response format.");

  return safeJsonParse(jsonMatch[0]);
}








// Helper to convert Gemini's uppercase types to standard lowercase JSON Schema (for Groq/OpenAI)
const convertSchemaToStandardJSON = (schema) => {
  if (!schema || typeof schema !== 'object') return schema;
  const newSchema = { ...schema };

  // Convert type to lowercase (e.g., "OBJECT" -> "object")
  if (typeof newSchema.type === 'string') {
    newSchema.type = newSchema.type.toLowerCase();
  }

  // Recursively convert nested properties
  if (newSchema.properties) {
    const newProps = {};
    for (const key in newSchema.properties) {
      newProps[key] = convertSchemaToStandardJSON(newSchema.properties[key]);
    }
    newSchema.properties = newProps;
  }

  // Recursively convert arrays
  if (newSchema.items) {
    newSchema.items = convertSchemaToStandardJSON(newSchema.items);
  }

  return newSchema;
};

// Helper to get YYYY-MM-DD for attendance queries
const getDateString = (dateObj) => {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};


class CRM_AIAgent {
  constructor() {
    this.name = "AWFI Core Agent";
  }

  // -------------------------------------------------------------
  // SKILL 1: Evening Operations Summary 
  // -------------------------------------------------------------
  async generateEveningTaskSummary() {
    console.log(`[${this.name}] Starting Evening Task Summary...`);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = getDateString(today);

    const todaysTasks = await prisma.task.findMany({
      where: {
        OR: [
          { updatedAt: { gte: today } },
          { subTasks: { some: { updatedAt: { gte: today } } } }
        ]
      },
      include: {
        // 🚨 UPDATED: employeeName and Department
        assignedTo: { select: { employeeName: true, City: true, Department: true } },
        subTasks: { select: { title: true, status: true, isCompleted: true, updatedAt: true } }
      }
    });

    // 🚨 UPDATED: employeeAttendance
    const todaysAttendance = await prisma.employeeAttendance.findMany({
      where: { dateString: todayStr },
      include: { employee: { select: { employeeName: true } } }
    });

    if (todaysTasks.length === 0 && todaysAttendance.length === 0) return;

    const { client, model, provider } = await getDynamicAIContext("GEMINI", "gemini-2.5-flash");

    const prompt = `
      You are the elite Operations Manager for Aiworksforce.
      Review the JSON data containing today's Task Updates and Attendance Logs.

      CRITICAL RULES:
      1. NEVER USE RAW IDs. ALWAYS use the actual 'employeeName'.
      2. Cross-reference attendance with productivity.
      3. YOU MUST RETURN ONLY VALID JSON. Do not include markdown formatting or backticks outside the JSON.

      EXPECTED JSON SCHEMA:
      {
        "executiveSummary": "1-2 sentences summarizing today's overall productivity and staff attendance",
        "attendanceAndWorkforce": ["Bullet point 1 about attendance", "Bullet point 2..."],
        "taskHighlights": ["Bullet point 1 about completed tasks citing employee names", "..."],
        "blockersAndAlerts": ["Bullet point 1 about stuck tasks or absent employees", "..."],
        "employeeSpotlight": "Name of top performer and 1 sentence why"
      }

      RAW DATA:
      TASKS: ${JSON.stringify(todaysTasks)}
      ATTENDANCE: ${JSON.stringify(todaysAttendance)}
    `;

    let reportContent = await executeDynamicPrompt(client, model, provider, prompt);
    reportContent = reportContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    await prisma.dailyAIReport.create({
      data: { type: "evening_summary", content: reportContent }
    });
    console.log(`[${this.name}] Evening Task & Attendance Summary Generated!`);
  }

  // -------------------------------------------------------------
  // SKILL 2: Morning Briefing 
  // -------------------------------------------------------------
  async generateMorningBrief() {
    console.log(`[${this.name}] Starting Morning Brief...`);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const yesterdayStr = getDateString(yesterday);

    const pendingTasks = await prisma.task.findMany({
      where: { status: { not: "completed" } },
      include: {
        assignedTo: { select: { employeeName: true } }, // 🚨 UPDATED
        subTasks: { where: { isCompleted: false }, select: { title: true } }
      }
    });

    // 🚨 UPDATED: employeeAttendance
    const yesterdayAttendance = await prisma.employeeAttendance.findMany({
      where: { dateString: yesterdayStr, status: { in: ['absent', 'leave'] } },
      include: { employee: { select: { employeeName: true } } }
    });

    if (pendingTasks.length === 0) return;

    const { client, model, provider } = await getDynamicAIContext("GEMINI", "gemini-2.5-flash");

    const prompt = `
      You are the elite Operations Manager for AWFI.
      Generate a morning plan based on pending tasks and yesterday's absences.

      CRITICAL RULES:
      1. NEVER USE RAW IDs. ALWAYS use the 'employeeName'.
      2. YOU MUST RETURN ONLY VALID JSON. Do not include markdown formatting or backticks outside the JSON.

      EXPECTED JSON SCHEMA:
      {
        "morningFocus": "A brief motivational directive",
        "priorityActionItems": ["Critical pending task 1 assigned to Employee Name", "Task 2..."],
        "carryoverAlerts": ["Alert 1 regarding tasks delayed due to absence", "..."]
      }

      RAW DATA:
      PENDING TASKS: ${JSON.stringify(pendingTasks)}
      YESTERDAY'S ABSENCES: ${JSON.stringify(yesterdayAttendance)}
    `;

    let reportContent = await executeDynamicPrompt(client, model, provider, prompt);
    reportContent = reportContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    await prisma.dailyAIReport.create({
      data: { type: "morning_brief", content: reportContent }
    });
    console.log(`[${this.name}] Morning Brief Generated!`);
  }


  // -------------------------------------------------------------
  // SKILL 3: Conversational Tool-Calling Chatbot
  // -------------------------------------------------------------
  async handleChat(userId, userType, message, sessionId = null) {
    console.log(`[${this.name}] Processing chat for ${userType}...`);

    let userContext = "";
    let dbQuery = {};
    let allowedToolNames = []; // 🚨 NEW: Track which tools this user can use

    if (userType === "admin") {
      const admin = await prisma.admin.findUnique({ where: { id: userId } });
      userContext = `You are talking to an Admin named ${admin.name}. You have full clearance to perform actions on their behalf.`;
      dbQuery = { adminId: userId };
      // Admins get everything
      allowedToolNames = agentToolsDefinitions.map(t => t.name);

    } else if (userType === "employee") {
      const employee = await prisma.employee.findUnique({ where: { id: userId } });
      userContext = `You are talking to an Employee named ${employee.employeeName} in the ${employee.Department} department. Answer their questions but keep responses restricted to their own tasks.`;
      dbQuery = { employeeId: userId };
      // Employees only get basic task tools
      allowedToolNames = ["get_employee_pending_tasks", "get_client_project_status"];

    } else {
      const customer = await prisma.customer.findUnique({ where: { id: userId } });
      const clientName = customer?.customerName || customer?.name || "Valued Client";
      
      userContext = `IMPORTANT: You are currently talking directly to a CLIENT / CUSTOMER named "${clientName}". You are their dedicated project assistant. Do NOT refer to them as an admin or employee. Be polite, professional, and helpful regarding their project updates. Use the get_client_project_status tool if they ask about progress.`;
      dbQuery = { customerId: userId };
      allowedToolNames = ["get_client_project_status"];
    }

    // 🚨 Filter the global tools list based on permissions
    const allowedTools = agentToolsDefinitions.filter(t => allowedToolNames.includes(t.name));

    let activeSessionId = sessionId;
    if (!activeSessionId) {
      const generatedTitle = message.split(" ").slice(0, 5).join(" ") + "...";
      const newSession = await prisma.agentChatSession.create({
        data: { title: generatedTitle, ...dbQuery }
      });
      activeSessionId = newSession.id;
    } else {
      await prisma.agentChatSession.update({
        where: { id: activeSessionId },
        data: { updatedAt: new Date() }
      });
    }

    const historyLogs = await prisma.agentChatHistory.findMany({
      where: { sessionId: activeSessionId },
      orderBy: { createdAt: 'asc' },
      take: 20
    });

    await prisma.agentChatHistory.create({
      data: { role: "user", content: message, sessionId: activeSessionId }
    });

    const { client, model, provider } = await getDynamicAIContext("GEMINI", "gemini-2.5-flash");
    const systemInstruction = `You are the AWFI Core Agent, a highly capable Agency assistant.\n\n${userContext}\n\nCurrent Time: ${new Date().toLocaleString()}.\nIf the user asks you to perform an action or check data, use the tools available to you. Format your final answers cleanly.`;

    let responseText = "";

    // ==========================================
    // GEMINI IMPLEMENTATION
    // ==========================================
    if (provider === "GEMINI") {
      const chatHistory = historyLogs.map(log => ({
        role: log.role === 'model' || log.role === 'function' ? 'model' : 'user',
        parts: [{ text: log.content }]
      }));

      // 🚨 Safely apply tools only if the user has access to any
      const chatConfig = { systemInstruction };
      if (allowedTools.length > 0) {
        chatConfig.tools = [{ functionDeclarations: allowedTools }];
      }

      const chat = client.chats.create({
        model: model,
        config: chatConfig,
        history: chatHistory
      });

      let result = await chat.sendMessage({ message: message });

      if (result.functionCalls && result.functionCalls.length > 0) {
        const call = result.functionCalls[0];
        console.log(`[${this.name}] Executing Gemini Action: ${call.name}`);

        // 🚨 PASS THE CONTEXT DOWN TO THE HANDLER
        const apiResponse = await agentToolsHandlers[call.name](
          call.args,
          { userId, userType } // <-- Security context
        );

        result = await chat.sendMessage({
          message: [{
            functionResponse: {
              name: call.name,
              response: apiResponse
            }
          }]
        });
      }

      responseText = result.text;
    }
    // ==========================================
    // OPENAI / GROQ IMPLEMENTATION
    // ==========================================
    else if (provider === "OPENAI" || provider === "GROQ") {
      const chatHistory = historyLogs.map(log => ({
        role: log.role === 'model' || log.role === 'function' ? 'assistant' : 'user',
        content: log.content
      }));

      const messages = [
        { role: "system", content: systemInstruction },
        ...chatHistory,
        { role: "user", content: message }
      ];

      // 🚨 Safely apply tools only if the user has access to any
      const apiPayload = {
        model: model,
        messages: messages,
      };

      if (allowedTools.length > 0) {
        apiPayload.tools = allowedTools.map(tool => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: convertSchemaToStandardJSON(tool.parameters)
          }
        }));
        apiPayload.tool_choice = "auto";
      }

      const response = await client.chat.completions.create(apiPayload);
      const responseMessage = response.choices[0].message;

      if (responseMessage.tool_calls) {
        messages.push(responseMessage);

        for (const toolCall of responseMessage.tool_calls) {
          console.log(`[${this.name}] Executing ${provider} Action: ${toolCall.function.name}`);
          const functionArgs = JSON.parse(toolCall.function.arguments);

          // 🚨 PASS THE CONTEXT DOWN TO THE HANDLER
          const apiResponse = await agentToolsHandlers[toolCall.function.name](
            functionArgs,
            { userId, userType } // <-- Security context
          );

          messages.push({
            tool_call_id: toolCall.id,
            role: "tool",
            name: toolCall.function.name,
            content: JSON.stringify(apiResponse),
          });
        }

        const finalResponse = await client.chat.completions.create({
          model: model,
          messages: messages,
        });

        responseText = finalResponse.choices[0].message.content;
      } else {
        responseText = responseMessage.content;
      }
    }

    await prisma.agentChatHistory.create({
      data: { role: "model", content: responseText, sessionId: activeSessionId }
    });

    return { text: responseText, sessionId: activeSessionId };
  }
}

export const aiAgent = new CRM_AIAgent();