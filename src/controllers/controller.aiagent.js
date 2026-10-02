// controllers/aiAgent.controller.js
import { aiAgent, productPriceCompareAgent, WebhookIntegratedAgent } from "../ai/agent.js";
import prisma from "../config/prismaClient.js";
import { getAggregatedProducts } from "../jobs/searchApiService.js";
import ApiError from "../utils/ApiError.js";

// Helper: Convert Prisma output to MongoDB-style + append optional webhook configuration
const transformAgent = (agent) => ({
    _id: agent.id,
    name: agent.name,
    description: agent.description,
    type: agent.type,
    status: agent.status,
    campaign: agent.campaign,
    targetSegment: agent.targetSegment,
    capability: agent.capability,
    AssignTo: agent.AssignTo,
    createdAt: agent.createdAt,
    promptRole: agent.promptRole,
    // Webhook settings safely fallback to null/defaults if missing from older agent profiles
    webhookUrl: agent.webhookUrl || null,
    webhookMethod: agent.webhookMethod || "POST",
    webhookHeaders: agent.webhookHeaders || null,
    webhookPayload: agent.webhookPayload || null,
});

// GET ALL AI AGENTS
// Lightweight, query-aware in-memory cache
const agentsCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minute

export const getAIAgents = async (req, res, next) => {
    try {
        const { keyword, limit, type, campaign } = req.query;

        // 1. Generate a unique cache key based on the exact query parameters
        const cacheKey = JSON.stringify({ keyword, limit, type, campaign });
        const now = Date.now();

        // 2. Serve from cache instantly if valid (0ms response time)
        if (agentsCache.has(cacheKey)) {
            const cached = agentsCache.get(cacheKey);
            if (cached.expiry > now) {
                return res.status(200).json(cached.data);
            } else {
                agentsCache.delete(cacheKey); // Clear stale data
            }
        }

        // 3. Build where clause
        const where = {};
        if (keyword) where.name = { contains: keyword.trim(), mode: "insensitive" };
        if (type) where.type = type.trim();
        if (campaign) where.campaign = campaign.trim();

        // 4. Execute Prisma Query
        const agents = await prisma.aIAgent.findMany({
            where,
            orderBy: { createdAt: "desc" },
            // Spreads the limit dynamically. If no limit is passed, it fetches everything.
            ...(limit && { take: Number(limit) }), 
            include: {
                AssignTo: {
                    select: { id: true, name: true, email: true, role: true },
                },
            },
        });

        // 5. 🚀 CRITICAL FIX: Wrap the map in Promise.all 
        // If transformAgent does any heavy lifting or async work, this forces it 
        // to process all 20 records concurrently instead of one-by-one.
        const transformedAgents = await Promise.all(
            agents.map((agent) => transformAgent(agent))
        );

        // 6. Save to cache
        agentsCache.set(cacheKey, {
            data: transformedAgents,
            expiry: now + CACHE_TTL_MS,
        });

        // Basic Garbage Collection to prevent RAM bloat
        if (agentsCache.size > 200) {
            const firstKey = agentsCache.keys().next().value;
            agentsCache.delete(firstKey);
        }

        return res.status(200).json(transformedAgents);
    } catch (error) {
        next(new ApiError(500, error.message));
    }
};
// GET AI AGENT BY ID
export const getAIAgentById = async (req, res, next) => {
    try {
        const agent = await prisma.aIAgent.findUnique({
            where: { id: req.params.id },
            include: {
                AssignTo: {
                    select: { id: true, name: true, email: true, role : true },
                },
            },
        });

        if (!agent) return next(new ApiError(404, "AI Agent not found"));

        res.status(200).json(transformAgent(agent));
    } catch (error) {
        next(new ApiError(500, error.message));
    }
};

// CREATE AI AGENT
export const createAIAgent = async (req, res, next) => {
    try {
        const {
            name,
            description,
            type,
            status,
            campaign,
            targetSegment,
            capability,
            promptRole,
            webhookUrl,
            webhookMethod,
            webhookHeaders,
            webhookPayload
        } = req.body;

        const newAgent = await prisma.aIAgent.create({
            data: {
                name,
                description,
                type,
                status,
                campaign,
                targetSegment,
                capability,
                promptRole,
                webhookUrl,
                webhookMethod: webhookMethod || "POST",
                webhookHeaders: webhookHeaders || undefined, // Prisma skips if undefined
                webhookPayload: webhookPayload || undefined,
            },
        });

        res.status(201).json(transformAgent(newAgent));
    } catch (error) {
        next(new ApiError(400, error.message));
    }
};

// UPDATE AI AGENT
export const updateAIAgent = async (req, res, next) => {
    try {
        const { id } = req.params;

        let updateData = { ...req.body };

        // Remove non-updatable fields
        delete updateData.id;
        delete updateData._id;
        delete updateData.createdAt;

        const updatedAgent = await prisma.aIAgent.update({
            where: { id },
            data: updateData,
        });

        res.status(200).json(transformAgent(updatedAgent));
    } catch (error) {
        if (error.code === "P2025") {
            return next(new ApiError(404, "AI Agent not found"));
        }
        next(new ApiError(400, error.message));
    }
};

// ASSIGN AI AGENT TO USERS
export const assignAIAgent = async (req, res, next) => {
    try {
        const { agentId, userIds } = req.body;

        if (!agentId) {
            return next(new ApiError(400, "Agent ID is required"));
        }

        if (!Array.isArray(userIds)) {
            return next(new ApiError(400, "userIds must be an array"));
        }

        const agent = await prisma.aIAgent.findUnique({
            where: { id: agentId },
        });

        if (!agent) {
            return next(new ApiError(404, "AI Agent not found"));
        }

        if (agent.status !== "Active") {
            return next(new ApiError(400, "Cannot assign users to inactive agent"));
        }

        const updatedAgent = await prisma.aIAgent.update({
            where: { id: agentId },
            data: {
                AssignTo: {
                    set: userIds.map((id) => ({ id })),
                },
            },
            include: {
                AssignTo: {
                    select: { id: true, name: true, email: true },
                },
            },
        });

        res.status(200).json({
            success: true,
            message: "Agent assigned successfully",
            data: updatedAgent,
        });
    } catch (error) {
        next(new ApiError(500, error.message));
    }
};

// DELETE AI AGENT
export const deleteAIAgent = async (req, res, next) => {
    try {
        await prisma.aIAgent.delete({
            where: { id: req.params.id },
        });

        res.status(200).json({ message: "AI Agent deleted successfully" });
    } catch (error) {
        if (error.code === "P2025") {
            return next(new ApiError(404, "AI Agent not found"));
        }
        next(new ApiError(500, error.message));
    }
};


export const runWebhookAgent = async (req, res, next) => {
    try {
        const { agentId, customerId, userPrompt } = req.body;

        if (!agentId) {
            return next(new ApiError(400, "agentId is required"));
        }

        const agent = await prisma.aIAgent.findUnique({ where: { id: agentId } });
        if (!agent) return next(new ApiError(404, "AI Agent not found"));
        if (!agent.webhookUrl) {
            return next(new ApiError(400, "This agent has no webhook configured"));
        }

        const customer = customerId
            ? await prisma.customer.findUnique({ where: { id: customerId } })
            : null;

        const webhookConfig = {
            url: agent.webhookUrl,
            method: agent.webhookMethod || "POST",
            headers: {
                "Content-Type": "application/json",
                ...(agent.webhookHeaders || {}),
            },
            basePayload: agent.webhookPayload || {},
            customPrompt:
                agent.promptRole ||
                "Analyze the data and generate a valid JSON payload.",
        };

        const payloadForAI = {
            customer,
            userPrompt,
        };

        const result = await WebhookIntegratedAgent(payloadForAI, webhookConfig);

        // Optional: persist an execution log if you have AgentExecutionLog wired up
        // await prisma.agentExecutionLog.create({
        //     data: {
        //         agentId: agent.id,
        //         input: payloadForAI,
        //         output: result,
        //         status: result?.webhookError ? "FAILED" : "SUCCESS",
        //     },
        // });
        console.log(" result is here ", result)
        return res.status(200).json({
            success: true,
            data: {
                leadTemperature: result?.aiData?.leadTemperature,
                aiReason: result?.aiData?.aiReason,
                answer: result?.aiData?.answer,
                aiData: result?.aiData,
                webhookResponse: result?.webhookResponse ?? null,
                webhookError: result?.webhookError ?? null,
            },
        });
    } catch (error) {
        next(new ApiError(400, error.message));
    }
};


export const compareProductPrice = async (req, res, next) => {
  try {
    const productName = String(req.body.product_name || req.body.query || "").trim();

    if (!productName) {
      return next(new ApiError(400, "Please enter a product name."));
    }

    // Call the newly converted Node service
    const { products, error } = await getAggregatedProducts(productName);

    if (!products || products.length === 0) {
      const msg = error ? `Search failed: ${error}` : "No specific product pages found. Try adding the model or variant.";
      return next(new ApiError(404, msg));
    }

    // Hit your dynamic Prisma AI context
    const summary = await productPriceCompareAgent(productName, products);

    return res.status(200).json({
      success: true,
      data: {
        product_name: productName,
        cheapest: products[0],
        products: products,
        all_results: products,
        summary: summary,
        ai_summary: summary,
        total_results: products.length
      }
    });

  } catch (error) {
    return next(new ApiError(500, error.message));
  }
};




// crm personal agent 

export const getDailyAIReports = async (req, res, next) => {
  try {
    const reports = await prisma.dailyAIReport.findMany({
      orderBy: { reportDate: 'desc' }
    });

    res.status(200).json({ 
      success: true, 
      data: reports 
    });
  } catch (error) {
    next(new ApiError(error.statusCode || 500, "Failed to fetch AI reports"));
  }
};

// 🚨 UPDATED: Now returns employeeId for employee requests
const getUserRelation = (req) => {
  if (req.admin) return { adminId: req.admin.id, userType: "admin", userId: req.admin.id };
  if (req.employee) return { employeeId: req.employee.id, userType: "employee", userId: req.employee.id };
  // Keep customer support just in case you use it later
  if (req.customer) return { customerId: req.customer.id, userType: "customer", userId: req.customer.id };
  throw new Error("Unauthorized context");
};

// 1. Send Message / Talk to AI
export const handleAiChat = async (req, res) => {
  try {
    const { message, sessionId } = req.body; 
    if (!message) return res.status(400).json({ success: false, message: "Message is required" });

    const { userId, userType } = getUserRelation(req);

    const aiResponse = await aiAgent.handleChat(userId, userType, message, sessionId);

    return res.status(200).json({
      success: true,
      data: aiResponse 
    });
  } catch (error) {
    console.error("AI Chat Error:", error);

    let errStr = "";
    try { errStr = JSON.stringify(error); } catch(e){}
    const msgStr = typeof error.message === 'string' ? error.message : "";

    const isQuotaError = 
      error.status === 429 || 
      msgStr.includes("429") || 
      msgStr.includes("RESOURCE_EXHAUSTED") ||
      msgStr.includes("Quota exceeded") ||
      errStr.includes("429") ||
      errStr.includes("Quota exceeded");

    if (isQuotaError) {
      return res.status(429).json({
        success: false,
        errorType: "QUOTA_EXCEEDED",
        message: "Gemini API Quota Exceeded: Free tier limit has been reached. Please wait ~50s or attach a paid API key.",
      });
    }

    return res.status(500).json({
      success: false,
      errorType: "INTERNAL_ERROR",
      message: msgStr || "Internal server error occurred while processing AI chat.",
    });
  }
};

// 2. Get All Chat Sessions for Sidebar
export const getChatSessions = async (req, res) => {
  try {
    const { adminId, employeeId, customerId } = getUserRelation(req);
    // 🚨 UPDATED: dynamic query based on role
    const dbQuery = adminId ? { adminId } : (employeeId ? { employeeId } : { customerId });

    const sessions = await prisma.agentChatSession.findMany({
      where: dbQuery,
      orderBy: [
        { isPinned: 'desc' },
        { updatedAt: 'desc' }
      ],
      select: { id: true, title: true, isPinned: true, updatedAt: true }
    });

    return res.status(200).json({ success: true, data: sessions });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to fetch sessions" });
  }
};

// 3. Get Messages for a specific Session
export const getSessionMessages = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { adminId, employeeId, customerId } = getUserRelation(req);
    const dbQuery = adminId ? { adminId } : (employeeId ? { employeeId } : { customerId });

    const session = await prisma.agentChatSession.findFirst({
      where: { id: sessionId, ...dbQuery }
    });

    if (!session) return res.status(404).json({ success: false, message: "Session not found" });

    const messages = await prisma.agentChatHistory.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, createdAt: true }
    });

    return res.status(200).json({ success: true, data: messages });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to fetch messages" });
  }
};

// 4. Toggle Pin Status
export const toggleSessionPin = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { adminId, employeeId, customerId } = getUserRelation(req);
    const dbQuery = adminId ? { adminId } : (employeeId ? { employeeId } : { customerId });

    const session = await prisma.agentChatSession.findFirst({
      where: { id: sessionId, ...dbQuery }
    });

    if (!session) return res.status(404).json({ success: false, message: "Session not found" });

    const updated = await prisma.agentChatSession.update({
      where: { id: sessionId },
      data: { isPinned: !session.isPinned }
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to pin session" });
  }
};

// 5. Delete Session
export const deleteSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { adminId, employeeId, customerId } = getUserRelation(req);
    const dbQuery = adminId ? { adminId } : (employeeId ? { employeeId } : { customerId });

    const session = await prisma.agentChatSession.findFirst({
      where: { id: sessionId, ...dbQuery }
    });

    if (!session) return res.status(404).json({ success: false, message: "Session not found" });

    await prisma.agentChatSession.delete({
      where: { id: sessionId }
    });

    return res.status(200).json({ success: true, message: "Session deleted" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to delete session" });
  }
};