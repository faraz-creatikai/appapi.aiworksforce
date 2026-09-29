import dotenv from "dotenv";
dotenv.config();

import { createServer } from "http";
import app from "./app.js";

import { startCallLogSync, syncCallLogsInternal } from "./jobs/syncCallLogs.js";
import { initFacebookCron, initInstagramCron } from "./jobs/instagramScheduler.js";
import { initSocket } from "./socket/socket.js";
import { deleteOldNotifications, initFollowupNotificationCron } from "./jobs/notification/notificationEvents.js";
import { initWhatsApp } from "./config/baileys.js";
import { sweepOldUploads } from "./jobs/cleanupUploads.js";
import "./jobs/attendance.js"; // ← Import the attendance job to ensure it runs
import { initializeAiCronJobs } from "./jobs/aiLiveJob.js";


const PORT = process.env.PORT || 5000;

// wrap app in an HTTP server, then hand it to socket.io
const server = createServer(app);
initSocket(server);

server.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  startCallLogSync(); // ← replaces the entire setInterval block

  initInstagramCron();
  initFacebookCron();
  initFollowupNotificationCron();
  initializeAiCronJobs();
 // await initWhatsApp();

  setInterval(async () => {
    try { await deleteOldNotifications(); }
    catch (err) { console.error("Notification cleanup error:", err); }
  }, 24 * 60 * 60 * 1000);

  // NEW: clean up old video-project uploads (photos + rendered videos)
  // every 15 minutes, plus once on boot in case of leftovers from a crash.
  sweepOldUploads().catch((err) =>
    console.error("Initial upload sweep error:", err)
  );
  setInterval(async () => {
    try { await sweepOldUploads(); }
    catch (err) { console.error("Upload cleanup error:", err); }
  }, 15 * 60 * 1000);
});

server.timeout = 600000; 
server.keepAliveTimeout = 600000;
server.headersTimeout = 601000;