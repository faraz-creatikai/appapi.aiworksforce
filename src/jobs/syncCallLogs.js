import prisma from "../config/prismaClient.js";

const toISODate = (val) => {
  if (!val) return null;

  // convert "2026-04-03 09:34:05"
  const iso = val.replace(" ", "T") + "Z";

  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
};


// ─── Sync logic ───────────────────────────────────────────────
const syncCallLogsInternal = async () => {
  const response = await fetch(
    `https://www.tabbly.io/dashboard/agents/endpoints/call-logs-v2?api_key=${process.env.TAPPLY_API_KEY}&organization_id=${process.env.TAPPLY_ORG_ID}&use_agent_id=${process.env.TAPPLY_CALL_AGENT_ID}`
  );

  const data = await response.json();
  if (!data?.data?.length) return;

  // ✅ Process in batches of 20 — not all at once
  // Prevents 500 simultaneous DB calls hammering MariaDB
  const BATCH_SIZE = 20;
  const logs = data.data;

  for (let i = 0; i < logs.length; i += BATCH_SIZE) {
    const batch = logs.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (log) => {
        const normalizedPhone = log.called_to?.slice(-10);

        const mappedData = {
          agentId: String(log.use_agent_id ?? ""),
          organizationId: String(log.organization_id ?? ""),
          calledTo: String(log.called_to ?? ""),
          normalizedPhone,
          callDirection: String(log.call_direction ?? ""),
          callStatus: String(log.call_status ?? ""),
          callDuration: String(log.call_duration ?? "0"),
          startTime: toISODate(log.start_time),
          endTime: toISODate(log.end_time),
          calledTime: toISODate(log.created_at),
          recordingUrl: String(log.call_recording_url ?? ""),
          transcript: String(log.call_transcript ?? ""),
          summary: String(log.call_summary ?? ""),
          sentiment: String(log.call_sentiment ?? ""),
          totalCallCost: String(log.total_call_cost ?? ""),
          telcoPricing: String(log.telco_pricing ?? ""),
          agentCost: String(log.agent_cost ?? ""),
          rawJson: log,
        };

        // ✅ upsert — creates if not exists, updates if exists
        await prisma.callLog.upsert({
          where: { participantIdentity: log.participant_identity },
          update: mappedData,
          create: {
            participantIdentity: log.participant_identity,
            ...mappedData,
          },
        });
      })
    );
  }
};

// ─── Self-contained interval with overlap lock ────────────────
// Import this in server.js and call startCallLogSync()

let syncRunning = false;
let intervalId = null; 

export const startCallLogSync = () => {
  // 1. GUARANTEE ONLY ONE INTERVAL EXISTS
  if (intervalId) {
    console.log("⚠️ Blocked attempt to start a duplicate call log sync.");
    return;
  }

  console.log("🚀 Initializing Call Log Sync Job (2-minute cycle)");

  intervalId = setInterval(async () => {
    if (syncRunning) {
      // Log this so we can see if timers are piling up on the server
      console.log("⏳ Sync skipped: Previous batch is still processing.");
      return; 
    }
    
    syncRunning = true;
    const start = Date.now();
    
    try {
      // 2. FETCH DATA
      const response = await fetch(
        `https://www.tabbly.io/dashboard/agents/endpoints/call-logs-v2?api_key=${process.env.TAPPLY_API_KEY}&organization_id=${process.env.TAPPLY_ORG_ID}&use_agent_id=${process.env.TAPPLY_CALL_AGENT_ID}`
      );
      
      const data = await response.json();
      if (!data?.data?.length) {
        syncRunning = false;
        return;
      }

      const logs = data.data;
      const BATCH_SIZE = 20;

      // 3. SEQUENTIAL BATCHING (Saves RAM)
      for (let i = 0; i < logs.length; i += BATCH_SIZE) {
        const batch = logs.slice(i, i + BATCH_SIZE);

        // Process this batch, but WAIT for it to finish before starting the next 20
        await Promise.all(
          batch.map(async (log) => {
            const normalizedPhone = log.called_to?.slice(-10);
            const mappedData = {
              agentId: String(log.use_agent_id ?? ""),
              organizationId: String(log.organization_id ?? ""),
              calledTo: String(log.called_to ?? ""),
              normalizedPhone,
              callDirection: String(log.call_direction ?? ""),
              callStatus: String(log.call_status ?? ""),
              callDuration: String(log.call_duration ?? "0"),
              startTime: toISODate(log.start_time),
              endTime: toISODate(log.end_time),
              calledTime: toISODate(log.created_at),
              recordingUrl: String(log.call_recording_url ?? ""),
              transcript: String(log.call_transcript ?? ""),
              summary: String(log.call_summary ?? ""),
              sentiment: String(log.call_sentiment ?? ""),
              totalCallCost: String(log.total_call_cost ?? ""),
              telcoPricing: String(log.telco_pricing ?? ""),
              agentCost: String(log.agent_cost ?? ""),
              rawJson: log,
            };

            return prisma.callLog.upsert({
              where: { participantIdentity: log.participant_identity },
              update: mappedData,
              create: {
                participantIdentity: log.participant_identity,
                ...mappedData,
              },
            });
          })
        );
      }
      
      console.log(`✅ syncCallLogs done in ${Date.now() - start}ms`);
    } catch (err) {
      console.error("❌ syncCallLogs error:", err.message);
    } finally {
      syncRunning = false;
    }
  }, 120000); 
};

export { syncCallLogsInternal };