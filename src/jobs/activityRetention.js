// src/jobs/activityRetention.js
// ---------------------------------------------------------------
// Deletes old activity logs & sessions. Runs once on boot, then daily.
// No new dependency — plain timer.
// ---------------------------------------------------------------

import prisma from "../config/prismaClient";


/** how long to keep detailed activity logs */
const KEEP_ACTIVITY_DAYS = Number(process.env.ACTIVITY_RETENTION_DAYS || 180);

/** how long to keep online/offline sessions (usually shorter — less useful old) */
const KEEP_SESSION_DAYS = Number(process.env.SESSION_RETENTION_DAYS || 90);

/** delete in chunks so a big first run never locks the table */
const CHUNK = 5000;

const daysAgo = (d) => new Date(Date.now() - d * 86400000);

const purgeInChunks = async (model, where, label) => {
  let total = 0;
  for (;;) {
    const rows = await prisma[model].findMany({
      where,
      select: { id: true },
      take: CHUNK,
    });
    if (rows.length === 0) break;

    await prisma[model].deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    total += rows.length;

    if (rows.length < CHUNK) break;
    await new Promise((r) => setTimeout(r, 200)); // breathe between chunks
  }
  if (total) console.log(`🧹 retention: deleted ${total} ${label}`);
  return total;
};

export const runActivityRetention = async () => {
  try {
    await purgeInChunks(
      "activityLog",
      { createdAt: { lt: daysAgo(KEEP_ACTIVITY_DAYS) } },
      `activity logs older than ${KEEP_ACTIVITY_DAYS}d`
    );

    await purgeInChunks(
      "userSession",
      { isOnline: false, loginAt: { lt: daysAgo(KEEP_SESSION_DAYS) } },
      `sessions older than ${KEEP_SESSION_DAYS}d`
    );

    // safety net: empty short sessions that slipped through
    await purgeInChunks(
      "userSession",
      {
        isOnline: false,
        durationSec: { lt: 20 },
        activities: { none: {} },
      },
      "junk sessions"
    );
  } catch (e) {
    console.error("activity retention failed:", e.message);
  }
};

/** call once from server startup */
export const startActivityRetention = () => {
  // run 30s after boot so it never competes with startup
  setTimeout(runActivityRetention, 30_000).unref?.();
  const t = setInterval(runActivityRetention, 24 * 60 * 60 * 1000); // daily
  t.unref?.();
};

// ---------------------------------------------------------------
// in your server entry (index.js / app.js):
//
//   import { startActivityRetention } from "./jobs/activityRetention.js";
//   startActivityRetention();
// ---------------------------------------------------------------