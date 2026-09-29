import { MiningDataAgent } from "../ai/agent.js";
import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";
import { ApifyClient } from "apify-client";


export const getRedditPosts = async (req, res, next) => {
  try {
    const { query } = req.params;

    // pagination params from frontend
    const { after = null, limit = 10 } = req.query;

    let url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${limit}`;

    // apply cursor pagination
    if (after) {
      url += `&after=${after}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    const posts = data?.data?.children || [];

    // ✅ CLEAN DATA
    const cleanedPosts = posts.map(p => ({
      title: p.data.title,
      text: p.data.selftext?.slice(0, 200) || "",
      subreddit: p.data.subreddit,
      author: p.data.author,
      upvotes: p.data.ups,
      comments: p.data.num_comments,
      url: `https://reddit.com${p.data.permalink}`
    }));

    // 🔥 OPTIONAL: send only top posts to AI (better performance)
    const topPosts = [...cleanedPosts]
      .sort((a, b) => (b.upvotes + b.comments) - (a.upvotes + a.comments))
      .slice(0, 5);

    const aiResponse = await MiningDataAgent({
      query,
      posts: topPosts
    });

    res.status(200).json({
      success: true,

      posts: cleanedPosts,

      // 🔥 pagination info for frontend
      pagination: {
        after: data?.data?.after || null,
        before: data?.data?.before || null,
        hasMore: !!data?.data?.after
      },

      insights: aiResponse
    });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


export const getFacebookPostsByQuery = async (req, res, next) => {
  try {
    const { query } = req.params;
    const { limit = 100 } = req.query;

    const posts = await prisma.facebookPost.findMany({
      where: query
        ? {
          OR: [
            { text: { contains: query } },
            { title: { contains: query } },
          ],
        }
        : {},
      orderBy: {
        engagementScore: "desc",
      },
      take: Number(limit),
    });

    const topPosts = posts.slice(0, 5);

    console.log(" post lenght are ", posts.length, " post are ", posts)

    const aiResponse = await MiningDataAgent({
      query,
      posts: topPosts,
    });

    res.json({
      success: true,
      posts,
      insights: aiResponse,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const getFacebookPosts = async (req, res, next) => {
  try {
    const { limit = 100 } = req.query;
    const query = "real estate trends";

    const posts = await prisma.facebookPost.findMany({
      orderBy: {
        engagementScore: "desc",
      },
      take: Number(limit),
    });

    const safePosts = posts.map((p) => ({
      ...p,
      timestamp: p.timestamp ? Number(p.timestamp) : null,
    }));

    const cleanedPosts = safePosts.map(p => {
      const text = (p.text || "").replace(/\n+/g, " ").trim();

      return {
        title: (p.title || "").slice(0, 120),
        text: text.slice(0, 300),

        source: "facebook",
        author: p.author || "unknown",

        upvotes: p.likes || 0,
        comments: p.comments || 0,
        shares: p.shares || 0,

        engagementScore: p.engagementScore || 0,

        url: p.url,

        externalLink: null,
        preview: null,
        subreddit: null
      };
    });

    const topPosts = [...cleanedPosts].slice(0, 20);

    console.log(" post lenght are ", posts.length, " post are ", posts)

    const aiResponse = await MiningDataAgent({
      query,
      posts: topPosts,
    });

    res.json({
      success: true,
      posts: safePosts,
      insights: aiResponse,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


//scrape facebook data 

export const scrapeFacebookPosts = async (req, res, next) => {
  try {

    const { groupUrls = [], limit, days } = req.body;

    const latestPost = await prisma.facebookPost.findFirst({
      orderBy: { createdAt: "desc" },
    });

    //buffer limit latest post - 30 min 

    const bufferMinutes = 30; // tweak (15–60 works best)

    const bufferedDate = latestPost?.createdAt
      ? new Date(latestPost.createdAt.getTime() - bufferMinutes * 60 * 1000)
      : null;

    //LATEST BY DAY

    const daysToUse = typeof days === "number" ? days : 1;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysToUse);
    startDate.setHours(0, 0, 0, 0);


    const client = new ApifyClient({
      token: process.env.APIFY_ACCESS_TOKEN,
    });

    // ✅ DEFAULT FALLBACK (only change)
    const DEFAULT_GROUPS = [
      "https://www.facebook.com/groups/1653894964926439/",
    ];

    const urlsToUse =
      Array.isArray(groupUrls) && groupUrls.length > 0
        ? groupUrls
        : DEFAULT_GROUPS;

    // ✅ OPTIONAL LIMIT (only change)
    const resultsLimit =
      typeof limit === "number"
        ? limit
        : latestPost
          ? 10
          : 20;

    const input = {
      startUrls: urlsToUse.map((url) => ({ url })), // dynamic + fallback
      resultsLimit: resultsLimit, // optional limit
      viewOption: "CHRONOLOGICAL",
      minDate: startDate.toISOString(),
      /* ...(latestPost?.createdAt && {
        maxDate: bufferedDate.toISOString(),
      }), */
    };

    // 🚀 STEP 1: START RUN (DO NOT USE call())
    const run = await client
      .actor("apify/facebook-groups-scraper")
      .call(input); // ✅ waits internally until done

    const runId = run.id;
    const datasetId = run.defaultDatasetId;

    // 🚀 STEP 3: FETCH FULL DATASET
    const { items } = await client
      .dataset(run.defaultDatasetId)
      .listItems({ limit: 50 });

    console.log(" item length", items.length, " items are , ", items);

    const posts = items || [];

    // 🚀 STEP 4: CLEAN + SAVE (UNCHANGED)

    const cleaned = [];

    for (const p of posts) {
      try {
        const text =
          p.text ||
          p.message ||
          p?.sharedPost?.text ||
          "";

        let media = [];

        if (Array.isArray(p.attachments)) {
          media = p.attachments
            .map((a) => a?.url || a?.media?.image?.uri || a?.media?.source)
            .filter(Boolean);
        }

        if (p?.sharedPost?.media?.length) {
          media.push(...p.sharedPost.media.map((m) => m?.url).filter(Boolean));
        }

        const hasContent = text.trim().length > 0 || media.length > 0;
        if (!hasContent) continue;

        // ✅ KEEP postId BUT DO NOT RELY ON IT
        const postId = p.id || p.legacyId || null;

        // ✅ URL IS YOUR REAL UNIQUE KEY
        const url = p.url;
        if (!url) continue; // only skip if truly broken

        const data = {
          postId,
          groupId: p.facebookId || null,

          title: text ? text.slice(0, 80) : null,
          text: text || "",

          url,

          author: p.user?.name || "unknown",
          authorId: p.user?.id || null,

          likes: p.likesCount || 0,
          comments: p.commentsCount || 0,
          shares: p.sharesCount || 0,

          engagementScore:
            (p.likesCount || 0) +
            (p.commentsCount || 0) * 2 +
            (p.sharesCount || 0) * 3,

          media,
          hasMedia: media.length > 0,
          isVideo: p.isVideo || false,

          createdAt: p.time ? new Date(p.time) : null,
          timestamp: p?.sharedPost?.timestamp || null,
        };

        // ✅ UPSERT USING URL (100% SAFE)
        await prisma.facebookPost.upsert({
          where: {
            url: url,
          },
          update: {
            ...data,
          },
          create: {
            ...data,
          },
        });

        cleaned.push(data);
      } catch (err) {
        console.log("❌ Skip failed item:", err.message);
        continue;
      }
    }

    return res.json({
      success: true,
      inserted: cleaned.length,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};



//instagram


export const getInstagramPosts = async (req, res, next) => {
  try {
    const { limit = 100 } = req.query;
    const query = "real estate trends";

    const posts = await prisma.instagramPost.findMany({
      where: {
        source: "instagram", // 🔥 IMPORTANT (filter IG only)
      },
      orderBy: {
        engagementScore: "desc",
      },
      take: Number(limit),
    });

    const safePosts = posts.map((p) => ({
      ...p,
      timestamp: p.timestamp ? Number(p.timestamp) : null,
    }));

    // 🔥 CLEAN FOR AI (same structure as FB but IG-friendly)
    const cleanedPosts = safePosts.map((p) => {
      const text = (p.text || "").replace(/\n+/g, " ").trim();

      return {
        title: (p.title || "").slice(0, 120),
        text: text.slice(0, 300),

        source: "instagram", // ✅ important

        author: p.author || "unknown",

        // 🔥 normalize naming (same as FB so AI works)
        upvotes: p.likes || 0,
        comments: p.comments || 0,
        shares: 0, // ❌ IG doesn't have shares

        engagementScore: p.engagementScore || 0,

        url: p.url,

        // IG doesn't have these → keep null for consistency
        externalLink: null,
        preview: p.media?.[0] || null, // 🔥 use first image as preview
        subreddit: null,
      };
    });

    // 🔥 send top posts to AI
    const topPosts = [...cleanedPosts].slice(0, 20);

    console.log(
      "📸 IG post length:",
      posts.length
    );

    const aiResponse = await MiningDataAgent({
      query,
      posts: topPosts,
    });

    res.json({
      success: true,
      posts: safePosts,
      insights: aiResponse,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const scrapeInstagramPosts = async (req, res, next) => {
  try {
    const { hashtags = [], limit, days } = req.body;

    const latestPost = await prisma.instagramPost.findFirst({
      orderBy: { createdAt: "desc" },
    });

    //buffer limit latest post - 30 min 

    const bufferMinutes = 30; // tweak (15–60 works best)

    const bufferedDate = latestPost?.createdAt
      ? new Date(latestPost.createdAt.getTime() - bufferMinutes * 60 * 1000)
      : null;


    // START DATE

    const daysToUse = typeof days === "number" ? days : 1;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysToUse);
    startDate.setHours(0, 0, 0, 0);

    const client = new ApifyClient({
      token: process.env.APIFY_ACCESS_TOKEN,
    });

    // ✅ DEFAULT FALLBACK (only change)
    const DEFAULT_HASHTAGS = [
      "realestate",
      "realestateindia",
      "propertyindia",
      "jaipurrealestate",
      "realestatejaipur",
      "jaipurproperties"
    ];

    const tagsToUse =
      Array.isArray(hashtags) && hashtags.length > 0
        ? hashtags
        : DEFAULT_HASHTAGS;

    const directUrls = tagsToUse.map(
      tag => `https://www.instagram.com/explore/tags/${tag}/`
    );

    // ✅ OPTIONAL LIMIT (only change)
    const resultsLimit =
      typeof limit === "number"
        ? limit
        : 2;

    const input = {
      directUrls,
      resultsType: "posts",
      resultsLimit: resultsLimit,
      minDate: startDate.toISOString(),
    };

    // ✅ use CALL (auto wait)
    const run = await client
      .actor("apify/instagram-api-scraper")
      .call(input);

    const { items } = await client
      .dataset(run.defaultDatasetId)
      .listItems({ limit: 50 });

    const cleaned = [];

    console.log(" items are ", items)

    for (const p of items) {
      try {
        const text = p.caption || "";

        // 🔥 MEDIA HANDLING (important for IG)
        let media = [];

        if (Array.isArray(p.images) && p.images.length > 0) {
          media = p.images;
        } else if (p.displayUrl) {
          media = [p.displayUrl];
        }

        // include child posts (carousel fallback)
        if (Array.isArray(p.childPosts)) {
          const childMedia = p.childPosts
            .map(c => c.displayUrl)
            .filter(Boolean);

          media.push(...childMedia);
        }

        // remove duplicates
        media = [...new Set(media)];

        const hasContent =
          text.trim().length > 0 || media.length > 0;

        if (!hasContent) continue;

        const data = {
          postId: p.id,

          // 🔥 reuse groupId as hashtag (your hack)
          groupId: p.hashtags?.[0] || "realestate",

          title: text ? text.slice(0, 80) : null,
          text: text || "",

          url: p.url,

          author: p.ownerUsername || "unknown",
          authorId: p.ownerId || null,

          likes: p.likesCount || 0,
          comments: p.commentsCount || 0,

          // ❌ IG doesn't have shares
          shares: 0,

          // 🔥 IG optimized engagement
          engagementScore:
            (p.likesCount || 0) +
            (p.commentsCount || 0) * 3,

          media,
          hasMedia: media.length > 0,

          isVideo: p.type === "Video",

          createdAt: p.timestamp
            ? new Date(p.timestamp)
            : null,

          source: "instagram",
        };

        if (!data.url) continue;

        await prisma.instagramPost.upsert({
          where: {
            url: data.url,
          },
          update: data,
          create: data,
        });

        cleaned.push(data);
      } catch (err) {
        console.log("❌ Skip IG item:", err.message);
      }
    }

    return res.json({
      success: true,
      inserted: cleaned.length,
      posts: cleaned,
      uncleaned: items
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


// mined leads operations

export const saveMinedLeads = async (req, res, next) => {
  try {
    const { leads } = req.body;

    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Leads array is required",
      });
    }

    // 🔥 sanitize + normalize payload
    const formattedLeads = leads.map((lead) => ({
      source: lead.source,
      author: lead.author ?? null,
      authorId: lead.authorId ?? null,
      title: lead.title ?? null,
      content: lead.content,
      url: lead.url,
      postContext: lead.postContext ?? null,
      postedAt: lead.postedAt ? new Date(lead.postedAt) : null,
    }));

    // 🔥 extract URLs for dedup check
    const urls = formattedLeads.map((l) => l.url);

    const existingLeads = await prisma.minedLead.findMany({
      where: {
        url: { in: urls },
      },
      select: { url: true },
    });

    const existingUrls = new Set(existingLeads.map((l) => l.url));

    // 🔥 filter new leads
    const newLeads = formattedLeads.filter(
      (l) => !existingUrls.has(l.url)
    );

    let savedCount = 0;

    // ✅ 1. Save new leads
    if (newLeads.length > 0) {
      const result = await prisma.minedLead.createMany({
        data: newLeads,
        skipDuplicates: true,
      });

      savedCount = result.count;
    }

    // ✅ 2. ALWAYS delete from source tables (based on ALL selected leads)
    const facebookUrls = formattedLeads
      .filter((l) => l.source === "facebook")
      .map((l) => l.url);

    const instagramUrls = formattedLeads
      .filter((l) => l.source === "instagram")
      .map((l) => l.url);

    if (facebookUrls.length > 0) {
      await prisma.facebookPost.deleteMany({
        where: {
          url: { in: facebookUrls },
        },
      });
    }

    if (instagramUrls.length > 0) {
      await prisma.instagramPost.deleteMany({
        where: {
          url: { in: instagramUrls },
        },
      });
    }

    return res.status(200).json({
      success: true,
      saved: savedCount,
      duplicates: leads.length - savedCount,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

export const getMinedLeads = async (req, res, next) => {
  try {
    const {
      source,          // 'reddit' | 'facebook' | 'instagram'
      search,          // text search
      page = 1,
      limit = 20,
      sortBy = "savedAt",   // 'savedAt' | 'postedAt'
      order = "desc",       // 'asc' | 'desc'
    } = req.query;

    const pageNumber = Math.max(Number(page), 1);
    const take = Math.min(Number(limit), 100); // cap to prevent abuse
    const skip = (pageNumber - 1) * take;

    /* ═══════════════════════════════════════════════
       FILTERS
    ════════════════════════════════════════════════ */
    const where = {
      ...(source && { source }),

      ...(search && {
        OR: [
          { content: { contains: search, } },
          { title: { contains: search, } },
          { author: { contains: search, } },
          { postContext: { contains: search, } },
        ],
      }),
    };

    /* ═══════════════════════════════════════════════
       QUERY
    ════════════════════════════════════════════════ */
    const [leads, total] = await Promise.all([
      prisma.minedLead.findMany({
        where,
        orderBy: {
          [sortBy]: order,
        },
        skip,
        take,
      }),

      prisma.minedLead.count({ where }),
    ]);

    /* ═══════════════════════════════════════════════
       RESPONSE
    ════════════════════════════════════════════════ */
    return res.status(200).json({
      success: true,
      data: leads,

      pagination: {
        total,
        page: pageNumber,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


export const convertLeads = async (req, res, next) => {
  try {
    const { leads } = req.body;

    /* ═══════════════════════════════════════════════
       VALIDATION
    ════════════════════════════════════════════════ */
    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Leads array is required",
      });
    }

    /* ═══════════════════════════════════════════════
     FETCH VALID REFERENCES (only once)
  ════════════════════════════════════════════════ */
    const references = await prisma.reference.findMany({
      where: {
        Status: "Active", // optional but recommended
      },
      select: {
        Name: true,
      },
    });

    // create fast lookup set
    const referenceSet = new Set(
      references.map((r) => r.Name.toLowerCase())
    );

    /* ═══════════════════════════════════════════════
       FORMAT DATA
    ════════════════════════════════════════════════ */
    const formattedCustomers = leads.map((item) => {
      const data = item?.data || {};
      const source = data?.source?.toLowerCase();
      return {
        Campaign: item?.Campaign || "",
        customerName: data?.author?.trim() || "N/A",
        ContactNumber: item?.ContactNumber,

        // optional useful mappings (safe)
        Description: data?.content || "",
        URL: data?.url || "",
        CustomerDate: data?.savedAt || "",

        ReferenceId: referenceSet.has(source) ? data.source : "",

        // relation
        CreatedById: req.admin?.id || null,
        updatedAt: new Date().toISOString(),
      };
    });

    /* ═══════════════════════════════════════════════
       INSERT (BULK)
    ════════════════════════════════════════════════ */
    await prisma.customer.createMany({
      data: formattedCustomers,
      /* skipDuplicates: true,  */// prevents duplicate ContactNumber crash
    });

    /* ═══════════════════════════════════════════════
   DELETE FROM minedLead
════════════════════════════════════════════════ */
    const urlsToDelete = leads
      .map((l) => l?.data?.url)
      .filter(Boolean);

    if (urlsToDelete.length > 0) {
      await prisma.minedLead.deleteMany({
        where: {
          url: { in: urlsToDelete },
        },
      });
    }

    /* ═══════════════════════════════════════════════
       RESPONSE
    ════════════════════════════════════════════════ */
    return res.status(201).json({
      success: true,
      message: `${formattedCustomers.length} lead(s) converted successfully`,
    });

  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


//Social Media Management Api



