import { callingAgentSystemPrompt } from "../ai/prompts/callingAgentPrompt.js";
import prisma from "../config/prismaClient.js";
import ApiError from "../utils/ApiError.js";
import fs from "fs";


const transformTably = (tably) => ({
    _id: tably.id,
    Name: tably.Name,
    Description: tably.Description,
    createdAt: tably.createdAt,
    updatedAt: tably.updatedAt,
});

export const getCurrentAgent = async (req, res, next) => {
    try {
        const { id } = req.params;

        const response = await fetch("https://www.tabbly.io/api/get-agents", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.TAPPLY_API_KEY}`
            },
            body: JSON.stringify({
                api_key: process.env.TAPPLY_API_KEY,

            })
        });

        let data = await response.json();
        data.data = data.data.filter(agent => agent.id === Number(process.env.TAPPLY_CALL_AGENT_ID));
        console.log("Tabbly Agent Data:", data);
        return res.status(200).json({
            success: true,
            data: data.data,
            count: data.count
        });

    } catch (error) {
        next(new ApiError(500, error.message));
    }
};

export const getAgentVoices = async (req, res, next) => {
    try {
        const { id } = req.params;

        const response = await fetch("https://tabbly.io/api/get-voices?api_key=" + process.env.TAPPLY_API_KEY, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.TAPPLY_API_KEY}`
            },
            body: JSON.stringify({
                api_key: process.env.TAPPLY_API_KEY,

            })
        });

        let data = await response.json();
        console.log("Tabbly Agent Data:", data);
        return res.status(200).json({
            success: true,
            data: data.voices,
            count: data.count
        });

    } catch (error) {
        next(new ApiError(500, error.message));
    }
};

export const updateCallingAgent = async (req, res, next) => {
    try {
        const { name,custom_first_line, prompt, status, voice_id } = req.body;
        /* 
                if (!name || !prompt) {
                    return next(new ApiError(400, "name and prompt are required"));
                } */
        const response = await fetch("https://tabbly.io/api/update-agent", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.TAPPLY_API_KEY}`
            },
            body: JSON.stringify({
                agent_id: process.env.TAPPLY_CALL_AGENT_ID,
                api_key: process.env.TAPPLY_API_KEY,
                agent_name: name,
                custom_first_line: custom_first_line,
                prompt_text: prompt,
                voice_id: Number(voice_id),
                status: status || "active"

            })
        });

        let data = await response.json();
        res.status(200).json({
            success: true,
            data: data,
        });

    }
    catch (error) {
        next(new ApiError(500, error.message));
    }
}



// ─────────────────────────────────────────────────────────────────────────────
// fetchTabblyAgentPrompt
//
// Internal service — fetches the current Tabbly agent's prompt_text directly.
// Bypasses Express req/res so it can be called from anywhere in the codebase.
//
// Returns: prompt_text string, or DEFAULT_AGENT_PROMPT as fallback.
// ─────────────────────────────────────────────────────────────────────────────

export const fetchTabblyAgentPrompt = async () => {
    try {
        const response = await fetch("https://www.tabbly.io/api/get-agents", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.TAPPLY_API_KEY}`,
            },
            body: JSON.stringify({
                api_key: process.env.TAPPLY_API_KEY,
            }),
        });

        if (!response.ok) {
            throw new Error(`Tabbly API responded with status ${response.status}`);
        }

        const data = await response.json();

        const targetId = Number(process.env.TAPPLY_CALL_AGENT_ID);
        const agent = data.data?.find((a) => a.id === targetId);

        if (!agent?.prompt_text) {
            console.warn("[tabblyAgentService] Agent not found or prompt_text empty — using default.");
            return callingAgentSystemPrompt;
        }

        console.log("fetched prompt", agent.prompt_text);
        const agentPrompt = agent.custom_first_line ? `${agent.custom_first_line}\n\n${agent.prompt_text}` : agent.prompt_text;

        return agentPrompt;

    } catch (error) {
        // Non-fatal: log and fall back to the hardcoded default so the calling
        // pipeline is never blocked by a Tabbly API outage.
        console.error("[tabblyAgentService] Failed to fetch agent prompt:", error.message);
        return callingAgentSystemPrompt;
    }
};