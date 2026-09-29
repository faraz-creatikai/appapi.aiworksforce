import { keywordSearchAgent, PropertyRecommendationAgent } from "./agent.js";


const DEFAULT_FIELDS = [
  "Description",
  "Campaign",
  "CustomerType",
  "CustomerSubType",
  "customerName",
  "ContactNumber",
  "City",
  "Location",
  "SubLocation",
  "Price",
  "ReferenceId",
  "CustomerDate",
];

const GEO_JUNK = new Set(["", "n/a", "na", "other", "others", "none", "null", "-", "unknown"]);

const norm = (v) => String(v || "").toLowerCase().trim().replace(/\s+/g, " ");

/** Drop the city/district/state and the customer's own locality from the nearby list. */
function sanitizeNearby(list, customer) {
  if (!Array.isArray(list)) return [];

  const city = norm(customer.City);
  const loc = norm(customer.Location);
  const sub = norm(customer.SubLocation);

  // "jaipur", "jaipur city", "jaipur district", "jaipur rural" all mean the whole city.
  const cityForms = new Set(
    [city, loc === city ? city : null]
      .filter(Boolean)
      .flatMap((c) => [c, `${c} city`, `${c} district`, `${c} dist`, `${c} rural`, `${c} urban`])
  );

  const seen = new Set();
  return list
    .map(norm)
    .filter((n) => {
      if (!n || GEO_JUNK.has(n)) return false;
      if (cityForms.has(n)) return false;          // the city itself is not "nearby"
      if (n === loc || n === sub) return false;    // their own area is not "nearby"
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    })
    .slice(0, 8);
}

export async function getKeywordSearchData(keyword) {
  try {
    const aiResult = await keywordSearchAgent(keyword);

    if (
      !Array.isArray(aiResult.tokens) ||
      !Array.isArray(aiResult.fields)
    ) {
      throw new Error("Invalid AI response");
    }
    console.log(" working");
    return {
      tokens: aiResult.tokens.filter(Boolean),
      fields: aiResult.fields.filter(f => DEFAULT_FIELDS.includes(f)),
      priceRange: aiResult.priceRange || { min: null, max: null }
    };
  } catch (err) {
    // 🔥 HARD FALLBACK (never break search)
    const tokens = keyword.split(" ").filter(Boolean);
    console.log(" somethng went wrong", err);
    return {
      tokens,
      fields: DEFAULT_FIELDS,
    };
  }
}


export async function getRecommendedKeywordSearchData(keyword, customer,
  followups) {
  try {

    const userMessage = {
      customer: {
        name: customer.customerName,
        description: customer.Description,
        price: customer.PriceNumber,
        city: customer.City,
        location: customer.Location,
        sublocation: customer.SubLocation,
        campaign: customer.Campaign,
        customertype: customer.CustomerType,
        customersubtype: customer.CustomerSubType
      },
      followups: followups.map((f) => ({
        description: f.Description,
        startdate: f.StartDate,
        followupNextDate: f.FollowupNextDate,
        status: f.Status,
      })),
      userPrompt: keyword
    };

    console.log(" userMessage ", userMessage)
    const aiResult = await PropertyRecommendationAgent(userMessage);
    console.log(" data ", aiResult)
    if (
      !aiResult.filters ||
      !Array.isArray(aiResult.filters.tokens) ||
      !Array.isArray(aiResult.filters.fields)
    ) {
      throw new Error("Invalid AI response");
    }
    console.log(" working");
    return {
      targetCampaign: aiResult.filters.targetCampaign || null, // 🔥 Extract strict campaign
      tokens: aiResult.filters.tokens.filter(Boolean),
      fields: aiResult.filters.fields.filter(f => DEFAULT_FIELDS.includes(f)),
     priceRange: aiResult.filters.priceRange || { min: null, max: null },

      // The AI still returns the city sometimes. Strip it here so a bad
      // suggestion can never widen "nearby" to mean "the entire city".
       nearbyLocations: sanitizeNearby(aiResult.filters.nearbyLocations, customer),
      answer: aiResult.answer || "No specific answer provided"
    };
  } catch (err) {
    // 🔥 HARD FALLBACK (never break search)
    const tokens = keyword.split(" ").filter(Boolean);
    console.log(" somethng went wrong", err);
    return {
      tokens,
      fields: DEFAULT_FIELDS,
    };
  }
}