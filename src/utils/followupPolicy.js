export const STATUS_TYPES = [
  "Interested", "Not Interested", "Callback Later",
  "No Response", "Converted", "Wrong Number",
];

export const DNC_STATUSES = ["Not Interested", "Wrong Number"];

export const QUIET_HOURS = { start: "09:30", end: "19:30" };

export const CHANNEL_LIMITS = {
  whatsapp: { maxChars: 900, softMaxChars: 400 },
  email: { maxSubject: 120 },
};

export const DEFAULT_NEXT_DAYS = {
  Interested: 2,
  "Callback Later": 3,
  "No Response": 3,
  "Not Interested": null,
  "Wrong Number": null,
  Converted: null,
};

const TZ = process.env.BUSINESS_TZ || "Asia/Kolkata";

export function toBusinessDate(d = new Date(), timeZone = TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export function toBusinessTime(d = new Date(), timeZone = TZ) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

export function isValidISODate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function isValidHHmm(s) {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

const mins = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function clampToQuietHours(sendOn, sendAt) {
  const t = isValidHHmm(sendAt) ? sendAt : "10:30";
  if (mins(t) < mins(QUIET_HOURS.start)) return { sendOn, sendAt: QUIET_HOURS.start };
  if (mins(t) > mins(QUIET_HOURS.end)) return { sendOn: addDays(sendOn, 1), sendAt: QUIET_HOURS.start };
  return { sendOn, sendAt: t };
}

export function toUtcInstant(sendOn, sendAt, timeZone = TZ) {
  const naive = new Date(`${sendOn}T${sendAt}:00Z`);
  const asString = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(naive);
  const [datePart, timePart] = asString.split(", ");
  const [mm, dd, yyyy] = datePart.split("/");
  const shifted = new Date(`${yyyy}-${mm}-${dd}T${timePart.replace(/^24/, "00")}Z`);
  const offsetMs = shifted.getTime() - naive.getTime();
  return new Date(naive.getTime() - offsetMs);
}

export function sanitizeEmailHtml(html = "") {
  return String(html)
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?>/gi, "")
    .replace(/<\/?(html|head|body)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .trim();
}

export function sanitizeWhatsAppText(text = "") {
  return String(text)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1: $2")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, CHANNEL_LIMITS.whatsapp.maxChars);
}

export function hasUnresolvedPlaceholder(s = "") {
  return /\{\{\s*[\w.]+\s*\}\}/.test(String(s));
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return null; }
};

export function isAllowedUrl(url, allowed = []) {
  const host = hostOf(url);
  if (!host) return false;
  return allowed.some((d) => {
    const dd = String(d).replace(/^www\./, "").toLowerCase();
    return host === dd || host.endsWith(`.${dd}`);
  });
}

export function stripDisallowedUrls(input = "", allowed = [], { html = false } = {}) {
  const removed = [];
  let out = String(input);

  if (html) {
    out = out.replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (full, href, label) => {
        if (isAllowedUrl(href, allowed)) return full;
        removed.push(href);
        return label;
      });
  }

  out = out.replace(URL_RE, (url) => {
    if (isAllowedUrl(url, allowed)) return url;
    removed.push(url);
    return "";
  });

  return { text: out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

export function formatPhoneForBaileys(phone, defaultCode = process.env.DEFAULT_COUNTRY_CODE || "91") {
  if (!phone) return null;
  const clean = String(phone).replace(/[^\d]/g, "");
  if (!clean) return null;
  const code = String(defaultCode).replace("+", "");
  return clean.length === 10 ? `${code}${clean}` : clean;
}

export function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}