import { GoogleGenAI } from "@google/genai"

export const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY, // make sure this is set
});


async function listModels() {
  const response = await gemini.models.list();
  console.log("Available models:", response);
}
