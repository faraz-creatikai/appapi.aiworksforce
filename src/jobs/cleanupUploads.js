// src/jobs/cleanupUploads.js
//
// Deletes anything sitting in uploads/ longer than MAX_AGE_MS. Catches
// photos and any final videos that were never downloaded (e.g. user closed
// the tab before clicking download).

import fs from "fs/promises";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const MAX_AGE_MS = Number(process.env.UPLOADS_MAX_AGE_MS) || 60 * 60 * 1000; // 1 hour default

export async function sweepOldUploads() {
  const entries = await fs.readdir(UPLOAD_DIR).catch(() => []);

  await Promise.all(
    entries.map(async (fileName) => {
      const filePath = path.join(UPLOAD_DIR, fileName);
      try {
        const stats = await fs.stat(filePath);
        if (Date.now() - stats.mtimeMs > MAX_AGE_MS) {
          await fs.unlink(filePath);
        }
      } catch {
        // already deleted by a concurrent sweep, or a race with download — ignore
      }
    })
  );
}