// utils/aiClientFactory.js
import { GoogleGenAI } from "@google/genai"; 
import OpenAI from "openai";
import Groq from "groq-sdk"; // <-- 1. Import Groq
import prisma from "../config/prismaClient.js";
import { decryptKey } from "../utils/cryptoHelper.js";

// DO NOT remove these! The useFallback function needs them.
import { gemini } from "../config/gemini.js";
import { openai } from "../config/openai.js";
// Optional: import { groq } from "../config/groq.js" if you create a hardcoded file for it

/**
 * Resolves the SDK by finding the SINGLE globally active master system key.
 * Falls back to hardcoded defaults if no custom master key is configured.
 * @param {'GEMINI' | 'OPENAI' | 'GROQ'} defaultProvider - The fallback provider if DB is empty
 * @param {string} defaultModel - The hardcoded model string to fall back to
 * @returns {Promise<{ client: any, model: string, provider: string }>}
 */
export async function getDynamicAIContext(defaultProvider, defaultModel) {
  
  // 1. Let's log exactly what was requested by the controller
  console.log(`[AI Factory] Requested Default Provider: ${defaultProvider}, Model: ${defaultModel}`);

  const useFallback = () => {
    let fallbackClient;
    
    console.log(`[AI Factory] USING FALLBACK FOR: ${defaultProvider}`); // Adjusted log

    if (defaultProvider === "GEMINI") {
      fallbackClient = gemini;
    } else if (defaultProvider === "GROQ") {
      fallbackClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    } else {
      fallbackClient = openai;
    }

    return {
      client: fallbackClient,
      model: defaultModel,
      provider: defaultProvider, 
    };
  };

  try {
    const configRecord = await prisma.adminAiApiKey.findFirst({
      where: {
        status: "ACTIVE",
        admin: {
          role: "administrator" 
        }
      },
    });

    if (!configRecord) {
      console.log("[AI Factory] No active DB key found. Triggering fallback.");
      return useFallback();
    }

    const plainTextKey = decryptKey(configRecord.apiKey);
    if (!plainTextKey) {
      console.warn(`[AI Factory] Failed to decrypt master key for ${configRecord.provider}. Triggering fallback.`);
      return useFallback();
    }

    let clientInstance;
    const activeProvider = configRecord.provider.toUpperCase();

    if (activeProvider === "GEMINI") {
      clientInstance = new GoogleGenAI({ apiKey: plainTextKey || process.env.GEMINI_API_KEY });
    } else if (activeProvider === "OPENAI") {
      clientInstance = new OpenAI({ apiKey: plainTextKey || process.env.OPENAI_API_KEY });
    } else if (activeProvider === "GROQ") {
      clientInstance = new Groq({ apiKey: plainTextKey || process.env.GROQ_API_KEY });
    } else {
      console.warn(`[AI Factory] Unsupported active provider in DB: ${activeProvider}. Triggering fallback.`);
      return useFallback();
    }

    // 2. THIS is likely where your code is actually exiting!
    console.log(`[AI Factory] SUCCESS: Database override active. Using DB Provider: ${activeProvider}`);

    return {
      client: clientInstance,
      model: configRecord.model || defaultModel, 
      provider: activeProvider 
    };
    
  } catch (error) {
    console.error(`[AI Factory] Error resolving system AI context:`, error.message);
    return useFallback();
  }
}