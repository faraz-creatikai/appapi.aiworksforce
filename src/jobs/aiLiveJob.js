import cron from "node-cron";
import { aiAgent } from "../ai/agent.js";


export const initializeAiCronJobs = () => {
  console.log("🟢 24/7 AI Agent Background Scheduler Initialized");

  // Run everyday at 6:00 PM (18:00)
  cron.schedule("44 16 * * *", async () => {
    try {
      await aiAgent.generateEveningTaskSummary();
    } catch (error) {
      console.error("Failed to run Evening Summary Job:", error);
    }
  });

  // Run everyday at 8:00 AM (08:00)
  cron.schedule("0 8 * * *", async () => {
    try {
      // await aiAgent.generateMorningBrief();
    } catch (error) {
      console.error("Failed to run Morning Brief Job:", error);
    }
  });
};