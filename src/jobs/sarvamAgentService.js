import { executeDynamicPrompt, safeJsonParse } from "../ai/agent.js";
import { getDynamicAIContext } from "../config/aiClientFactory.js";


export const buildSarvamCallingPrompt = (baseContext) => `
You are a Meta AI Calling Agent Planner.
 
Your ONLY job: generate a complete calling instruction for a voice AI agent.
 
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT — STRICTLY REQUIRED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "callingPrompt": "",
  "aiAnswer": ""
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CUSTOMER CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${JSON.stringify(baseContext, null, 2)}

Return ONLY valid JSON. Nothing else. Must be in Hindi.
`;

export async function generateSarvamAgentInstructions(userMessage) {
  const systemPrompt = buildSarvamCallingPrompt(userMessage);
  
  const { client, model, provider } = await getDynamicAIContext("GEMINI", "models/gemini-2.5-flash-lite");
  const raw = await executeDynamicPrompt(client, model, provider, systemPrompt);

  if (!raw || !raw.trim()) throw new Error("AI returned empty response");

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Invalid AI response format");

  return safeJsonParse(jsonMatch[0]);
}