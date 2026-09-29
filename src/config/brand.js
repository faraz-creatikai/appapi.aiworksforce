const env = (key, fallback) => {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
};



// ── EDIT THIS ONLY ──────────────────────────────────────────
export const BRAND = {
  name: process.env.BRAND_NAME || "EstateAI",
  website: process.env.BRAND_WEBSITE || "https://estateai.com",
  email: process.env.BRAND_EMAIL || "support@estateai.com",
  phone: process.env.BRAND_PHONE || "",
  signAs: process.env.BRAND_SIGN_AS || "EstateAI Team",
};




