// jobs/searchApiService.js

const KNOWN_PLATFORM_NAMES = {
  "amazon.in": "Amazon", "flipkart.com": "Flipkart", "croma.com": "Croma",
  "reliancedigital.in": "Reliance Digital", "vijaysales.com": "Vijay Sales",
  "tatacliq.com": "Tata CLiQ", "myntra.com": "Myntra", "ajio.com": "AJIO",
  "meesho.com": "Meesho", "nykaa.com": "Nykaa"
};

const DISALLOWED_HOSTS = new Set([
  "youtube.com", "reddit.com", "quora.com", "wikipedia.org", "google.com",
  "facebook.com", "instagram.com", "pinterest.com", "twitter.com"
]);

const VARIANT_WORDS = new Set(["pro", "plus", "max", "ultra", "mini", "lite", "neo", "fe"]);
const IGNORED_QUERY_WORDS = new Set(["price", "buy", "online", "india", "latest", "best", "cheap"]);

const BLOCKED_WORDS = [
  "refurbished", "renewed", "second hand", "used", "open box", "dummy phone",
  "replacement", "digitizer", "lcd display", "spare part", "spare parts"
];
// NOTE: words like "case", "tempered glass", "screen guard", "charging cable",
// "earbuds" were deliberately removed from this list. Sellers on Amazon/Flipkart
// routinely bundle these into a genuine phone listing's title (e.g. "iPhone 15
// (128GB) + Free Tempered Glass"), and hard-blocking on the word alone was
// silently rejecting real phone listings. priceIsReasonable() already filters
// out pure-accessory listings, since a case/cable alone can't fall inside the
// ₹10,000–₹250,000 iPhone price band — so the word block was redundant there
// and actively harmful for bundles.

// --- Simple category detection so we don't waste API quota querying
// fashion sites for a phone search or electronics sites for a shoe search.
const ELECTRONICS_KEYWORDS = [
  "iphone", "phone", "mobile", "smartphone", "laptop", "macbook", "tablet", "ipad",
  "tv", "television", "earbuds", "headphone", "smartwatch", "watch", "camera",
  "console", "playstation", "xbox", "router", "monitor", "processor", "gpu",
  "graphics card", "ac", "air conditioner", "refrigerator", "washing machine"
];
const FASHION_KEYWORDS = [
  "shoe", "shoes", "sneaker", "sneakers", "shirt", "tshirt", "t-shirt", "jeans",
  "dress", "kurta", "saree", "bag", "handbag", "purse", "wallet", "jacket",
  "makeup", "lipstick", "perfume", "sandal", "heel", "jewellery", "jewelry"
];

const ELECTRONICS_SITES = ["amazon.in", "flipkart.com", "croma.com", "reliancedigital.in", "vijaysales.com", "tatacliq.com"];
const FASHION_SITES = ["amazon.in", "flipkart.com", "myntra.com", "ajio.com", "nykaa.com", "meesho.com", "tatacliq.com"];
const DEFAULT_SITES = ["amazon.in", "flipkart.com", "croma.com", "reliancedigital.in", "tatacliq.com", "myntra.com"];

function normalize(value) {
  const str = String(value || "").toLowerCase();
  const matches = str.match(/[a-z0-9]+/g);
  return matches ? matches.join(" ") : "";
}

const NORMALIZED_BLOCKED_WORDS = BLOCKED_WORDS.map(normalize);

function detectTargetSites(productName) {
  const n = normalize(productName);
  const isFashion = FASHION_KEYWORDS.some(k => n.includes(normalize(k)));
  const isElectronics = ELECTRONICS_KEYWORDS.some(k => n.includes(normalize(k)));
  if (isFashion && !isElectronics) return FASHION_SITES;
  if (isElectronics && !isFashion) return ELECTRONICS_SITES;
  return DEFAULT_SITES;
}

// Sites that don't set a proper per-product og:image often fall back to a
// sitewide default (their logo, a header asset, a generic banner). Showing
// that as the "product photo" is worse than showing nothing, so we detect
// and reject the common patterns instead.
function looksLikeGenericImage(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  const genericPatterns = [
    "logo", "icon", "favicon", "sprite", "placeholder", "default-image",
    "/header/", "/common/", "no-image", "noimage", "og-default", "/banner/"
  ];
  return genericPatterns.some(p => lower.includes(p));
}

// Known image-CDN hosts per platform. An image is only trustworthy as "the
// product photo" if it's actually hosted by the retailer's own CDN — not by
// a third-party proxy (like Google's own thumbnail cache) that merely
// guessed at *some* image associated with the page.
const PLATFORM_IMAGE_HOSTS = {
  "Amazon": ["media-amazon.com", "ssl-images-amazon.com", "images-amazon.com"],
  "Flipkart": ["flixcart.com"],
  "Croma": ["croma.com", "cromaretail.com"],
  "Reliance Digital": ["reliancedigital.in", "jiomart.com"],
  "Vijay Sales": ["vijaysales.com"],
  "Tata CLiQ": ["tatacliq.com"],
  "Myntra": ["myntassets.com", "myntra.com"],
  "AJIO": ["ajio.com"],
  "Nykaa": ["nykaa.com", "nykaacdn.com"],
  "Meesho": ["meesho.com"]
};

// Hosts that are always a proxy/cache rather than the retailer's own image —
// reject these outright regardless of platform. This is exactly what caught
// the encrypted-tbn0.gstatic.com thumbnail: it's Google's own image-cache
// infra, not something sourced from the retailer's product data, so there's
// no way to confirm it actually depicts the listed product.
const IMAGE_PROXY_HOSTS = ["gstatic.com", "googleusercontent.com", "google.com", "bing.com", "duckduckgo.com"];

function imageIsTrustworthy(imgUrl, platform) {
  if (!imgUrl || looksLikeGenericImage(imgUrl)) return false;
  let host;
  try { host = new URL(imgUrl).hostname.toLowerCase(); } catch (e) { return false; }
  if (IMAGE_PROXY_HOSTS.some(p => host.includes(p))) return false;
  const allowed = PLATFORM_IMAGE_HOSTS[platform];
  if (allowed) return allowed.some(h => host.includes(h));
  // Unknown platform: we can't verify against a known CDN, but we've at
  // least ruled out generic assets and known third-party proxies.
  return true;
}

function cleanPrice(value) {
  if (value == null) return null;
  if (typeof value === "number") return value > 0 ? value : null;
  const match = String(value).match(/[\d,]+(?:\.\d{1,2})?/);
  if (!match) return null;
  const parsed = parseFloat(match[0].replace(/,/g, ""));
  return isNaN(parsed) ? null : parsed;
}

function formatPrice(price) {
  try {
    return `₹${Math.round(price).toLocaleString('en-IN')}`;
  } catch (e) {
    return "Price unavailable";
  }
}

function getHostname(urlString) {
  try {
    let hostname = new URL(urlString).hostname.toLowerCase();
    return hostname.startsWith("www.") ? hostname.substring(4) : hostname;
  } catch (e) { return ""; }
}

function platformNameFromUrl(urlString) {
  const hostname = getHostname(urlString);
  if (KNOWN_PLATFORM_NAMES[hostname]) return KNOWN_PLATFORM_NAMES[hostname];
  if (!hostname) return "Unknown store";
  return hostname.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

// --- Loosened from a strict whitelist to a blacklist-first approach.
// We still apply strong platform-specific signals where we know the pattern,
// but we no longer reject unknown-but-valid product URL shapes outright.
function isExactProductUrl(urlString, platform) {
  if (!urlString || !urlString.startsWith("http")) return false;
  const lower = urlString.toLowerCase();
  const blocked = [
    "/search", "?q=", "&q=", "/q/", "search?", "keyword=", "/category",
    "/collections", "/b?", "node=", "/b/", "/s?", "/stores/", "/browse", "/list/", "/listing"
  ];
  if (blocked.some(b => lower.includes(b))) return false;

  let path;
  try { path = new URL(urlString).pathname; } catch (e) { return false; }

  if (platform === "Amazon") {
    return lower.includes("/dp/") || lower.includes("/gp/product/") || lower.includes("/gp/aw/d/");
  }
  // Most Indian e-comm platforms share the /p/<id>/<slug> or ?pid= convention.
  // Giving each of these its own strong check (instead of falling through to
  // the loose generic fallback) is what stops category/listing pages like
  // vijaysales.com/c/iphones from being scored as products.
  if (["Flipkart", "Croma", "Reliance Digital", "Vijay Sales", "Nykaa", "Meesho"].includes(platform)) {
    return lower.includes("/p/") || lower.includes("pid=");
  }
  if (platform === "Myntra") {
    return /\/\d{5,}\/buy/.test(lower) || lower.includes("/buy");
  }
  if (platform === "AJIO" || platform === "Tata CLiQ") {
    return lower.includes("/p/") || lower.includes("/p-mp");
  }

  // Generic fallback for any other, unrecognized platform. Product detail
  // pages are almost always either an ID-bearing path or a multi-word
  // descriptive slug (e.g. "apple-iphone-15-128-gb-storage-blue").
  // Category/listing pages are typically a single generic word (e.g.
  // "iphones", "mobiles") with no digits at all — reject those.
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  const last = segments[segments.length - 1];
  const hasDigits = /\d/.test(last);
  const wordCount = last.split("-").filter(Boolean).length;
  if (!hasDigits && wordCount < 3) return false;
  return true;
}

function priceIsReasonable(productName, price) {
  price = cleanPrice(price);
  if (!price || price <= 0) return false;
  const prod = normalize(productName);
  if (prod.includes("iphone")) return price >= 10000 && price <= 250000;
  if (prod.includes("macbook")) return price >= 20000 && price <= 500000;
  if (["laptop", "phone", "mobile"].some(w => prod.includes(w))) return price >= 2000 && price <= 500000;
  if (["shoe", "shoes", "sneaker", "sneakers", "purse", "bag", "handbag"].some(w => prod.includes(w))) return price >= 150 && price <= 50000;
  return price >= 50 && price <= 1000000;
}

// Very light stemming so "iPhones"/"iPhone", "shoes"/"shoe" etc. count as
// matches instead of silently missing each other.
function stem(word) {
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function productMatchScore(query, resultText) {
  const qText = normalize(query);
  const rText = normalize(resultText);
  if (!qText || !rText) return 0;

  for (const w of NORMALIZED_BLOCKED_WORDS) {
    if (rText.includes(w)) return 0;
  }

  const qWordsRaw = qText.split(" ");
  const qWords = qWordsRaw.filter(w => !IGNORED_QUERY_WORDS.has(w) && !VARIANT_WORDS.has(w) && w.length >= 2).map(stem);
  const rWords = new Set(rText.split(" ").map(stem));

  const modelTokens = qWordsRaw.filter(w => /^[a-z]{1,3}\d{1,4}[a-z]{0,2}$/.test(w) || /^\d{1,4}[a-z]{1,3}$/.test(w));
  if (modelTokens.length > 0) {
    if (!modelTokens.every(t => rWords.has(t))) return 0;
    return 100;
  }

  if (qWords.length === 0) return 100;

  let matched = 0;
  for (const w of qWords) {
    if (rWords.has(w)) matched++;
  }

  if (matched === 0) return 60;
  return Math.round((matched / qWords.length) * 100);
}

// --------------------------------------------------------------------------------------------
// SEARCH FETCH HELPERS (with pagination + resilience)
// --------------------------------------------------------------------------------------------

async function fetchSiteResults(apiKey, cxId, query, maxPages) {
  const items = [];
  for (let page = 0; page < maxPages; page++) {
    const start = page * 10 + 1;
    const params = new URLSearchParams({
      key: apiKey, cx: cxId, q: query, gl: "in", hl: "en", num: "10", start: String(start)
    });
    let data;
    try {
      const res = await fetch(`https://customsearch.googleapis.com/customsearch/v1?${params.toString()}`);
      data = await res.json();
    } catch (e) {
      console.warn(`[searchApiService] fetch failed for "${query}": ${e.message}`);
      break;
    }
    if (data.error) {
      console.warn(`[searchApiService] API error for "${query}": ${data.error.message}`);
      break;
    }
    const pageItems = data.items || [];
    items.push(...pageItems);
    if (pageItems.length < 10) break; // no more pages available
  }
  return items;
}

// --------------------------------------------------------------------------------------------
// STRUCTURED METADATA ENGINE (PARALLEL TARGETING)
// --------------------------------------------------------------------------------------------

export async function getAggregatedProducts(productName, options = {}) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cxId = process.env.CX_ID;

  if (!apiKey || !cxId) {
    return { products: [], error: "Server Configuration Error: Missing GOOGLE_API_KEY or CX_ID." };
  }

  // Fetch up to `maxPages` pages of 10 results per site query.
  // Bump SEARCH_MAX_PAGES (or pass options.maxPages) to trade API quota for more results.
  const maxPages = options.maxPages || Number(process.env.SEARCH_MAX_PAGES) || 1;
  const targetSites = detectTargetSites(productName);
  const targetQueries = targetSites.map(site => `${productName} site:${site}`);
  // One unrestricted query with no site: filter. This is what lets platforms
  // outside our hardcoded list (smaller D2C/Shopify stores, brand-official
  // stores, retailers we haven't thought to add) surface at all — they still
  // have to clear DISALLOWED_HOSTS, isExactProductUrl, priceIsReasonable and
  // productMatchScore like everything else, so this widens coverage without
  // widening what counts as a valid result.
  targetQueries.push(`${productName} buy price`);

  const rawOffers = [];
  const seenUrls = new Set();
  let anySucceeded = false;
  let lastErrorMessage = null;
  const queryDiagnostics = [];

  const settled = await Promise.allSettled(
    targetQueries.map(q => fetchSiteResults(apiKey, cxId, q, maxPages))
  );

  settled.forEach((result, i) => {
    queryDiagnostics.push({
      query: targetQueries[i],
      status: result.status,
      raw_items: result.status === "fulfilled" ? result.value.length : 0,
      error: result.status === "rejected" ? (result.reason?.message || String(result.reason)) : null
    });
  });

  for (const result of settled) {
    if (result.status !== "fulfilled") {
      lastErrorMessage = result.reason?.message || String(result.reason);
      continue;
    }
    anySucceeded = true;

    for (const item of result.value) {
      const title = item.title;
      const link = item.link;
      if (!title || !link || seenUrls.has(link)) continue;
      seenUrls.add(link);

      let price = null;
      let imgUrl = "";
      const pm = item.pagemap || {};

      if (Array.isArray(pm.offer)) {
        for (const offer of pm.offer) {
          const cleaned = cleanPrice(offer.price);
          if (cleaned) { price = cleaned; break; }
        }
      }

      if (!price && Array.isArray(pm.product)) {
        for (const product of pm.product) {
          const cleaned = cleanPrice(product.price || product.lowprice || product.highprice);
          if (cleaned) { price = cleaned; break; }
        }
      }

      if (!price && Array.isArray(pm.metatags)) {
        for (const meta of pm.metatags) {
          const rawPrice = meta['product:price:amount'] || meta['og:price:amount'] || meta['twitter:data1'] || meta['price'];
          const cleaned = cleanPrice(rawPrice);
          if (cleaned) { price = cleaned; break; }
        }
      }

      // FIX: this used to only run when item.pagemap existed, silently
      // dropping every result that lacked structured pagemap data (most of them).
      // It now always runs as a fallback, and scans title + snippet + htmlSnippet,
      // with a broadened regex to catch prices without a leading currency symbol.
      if (!price) {
        const textToScan = `${item.snippet || ""} ${item.htmlSnippet || ""} ${title}`;
        let priceMatch = textToScan.match(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i);
        if (!priceMatch) {
          // bare Indian-format number (e.g. "58,900") as a last resort
          priceMatch = textToScan.match(/\b(\d{1,3}(?:,\d{2,3})+)\b/);
        }
        if (priceMatch) price = cleanPrice(priceMatch[1]);
      }

      const platform = platformNameFromUrl(link);

      // Try each candidate in priority order. cse_thumbnail is deliberately
      // excluded — it's always a Google-hosted proxy thumbnail (like the
      // encrypted-tbn0.gstatic.com case), never the retailer's own image, so
      // it can never pass imageIsTrustworthy anyway. A blank thumbnail is
      // more honest than a wrong or unverifiable one.
      const imageCandidates = [
        Array.isArray(pm.cse_image) && pm.cse_image[0] && pm.cse_image[0].src,
        Array.isArray(pm.metatags) && pm.metatags[0] && pm.metatags[0]['og:image'],
        Array.isArray(pm.product) && pm.product[0] && pm.product[0].image
      ];
      for (const candidate of imageCandidates) {
        if (imageIsTrustworthy(candidate, platform)) {
          imgUrl = candidate;
          break;
        }
      }

      if (price) {
        rawOffers.push({
          title,
          url: link,
          price,
          thumbnail: imgUrl,
          rating: "N/A",
          reviews: "N/A",
          source: platform
        });
      }
    }
  }

  if (!anySucceeded) {
    return { products: [], error: `Google API Error: ${lastErrorMessage || "All search queries failed."}` };
  }

  // --- FILTERING PIPELINE ---
  const candidates = [];

  for (const offer of rawOffers) {
    const link = offer.url;
    const platform = platformNameFromUrl(link);

    if (DISALLOWED_HOSTS.has(getHostname(link))) continue;
    if (!isExactProductUrl(link, platform)) continue;

    const score = productMatchScore(productName, offer.title);
    if (score <= 0 || !priceIsReasonable(productName, offer.price)) continue;

    candidates.push({
      platform,
      product_name: offer.title,
      numeric_price: offer.price,
      price: formatPrice(offer.price),
      url: link,
      product_url: link,
      direct_link: link,
      thumbnail: offer.thumbnail || "",
      rating: offer.rating || "N/A",
      reviews: offer.reviews || "N/A",
      price_verified: true,
      price_source: "Google API",
      match_score: score
    });
  }

  if (candidates.length === 0) {
    return { products: [], error: "No specific product pages found matching filtering criteria." };
  }

  // Keep up to 3 distinct listings per platform (cheapest first) instead of
  // collapsing each platform down to a single item — gives real variety
  // (different sellers/colors/storage) instead of one item total.
  const byPlatform = {};
  for (const item of candidates) {
    if (!byPlatform[item.platform]) byPlatform[item.platform] = [];
    byPlatform[item.platform].push(item);
  }

  const deduped = [];
  for (const platform in byPlatform) {
    const list = byPlatform[platform].sort((a, b) => a.numeric_price - b.numeric_price);
    const seenSignatures = new Set();
    let kept = 0;
    for (const item of list) {
      if (kept >= 3) break;
      const signature = normalize(item.product_name).split(" ").slice(0, 6).join(" ");
      if (seenSignatures.has(signature)) continue;
      seenSignatures.add(signature);
      deduped.push(item);
      kept++;
    }
  }

  const sorted = deduped.sort((a, b) => a.numeric_price - b.numeric_price).slice(0, 30);

  return { products: sorted, error: null };
}

