// ---------------------------------------------------------------
// Online / offline tracking with SESSION RESUME.
//
// A dropped socket does NOT close the session immediately. We wait
// GRACE_MS — if the same admin reconnects (page refresh, route change,
// HMR, wifi blip, second tab) we resume the SAME session instead of
// creating a new one. Only a real absence closes it.
// ---------------------------------------------------------------
import prisma from "../config/prismaClient.js";
import { getViewerAdminIds, liveSessions } from "../utils/activityLogger.js";

/** how long a user can be disconnected before we call it a real logout */
const GRACE_MS = 90_000;          // 90 seconds

/** sessions shorter than this WITH zero activity are junk — deleted, not stored */
const MIN_SESSION_SEC = 20;

/** adminId -> Set<socketId> */
const sockets = new Map();
/** adminId -> Timeout (waiting to see if they come back) */
const pendingOffline = new Map();

const emitPresence = async (io, admin, payload) => {
  try {
    const viewers = await getViewerAdminIds(admin);
    const rooms = viewers.map((id) => `admin:${id}`);
    if (rooms.length) io.to(rooms).emit("activity:presence", payload);
  } catch (e) {
    console.error("presence emit failed:", e.message);
  }
};

const adminForPresence = (adminId) =>
  prisma.admin.findUnique({
    where: { id: adminId },
    select: { id: true, name: true, role: true, city: true, clientId: true, createdBy: true, isSuperAdmin: true },
  });

// ---------------------------------------------------------------
// close (or discard) a session once the grace window expires
// ---------------------------------------------------------------
const closeSession = async (io, adminId, sessionId, seenAt) => {
  pendingOffline.delete(adminId);
  if (sockets.has(adminId)) return;                 // they came back — abort

  try {
    const session = await prisma.userSession.findUnique({ where: { id: sessionId } });
    if (!session) { liveSessions.delete(adminId); return; }

    const durationSec = Math.max(0, Math.round((seenAt - new Date(session.loginAt)) / 1000));
    const activityCount = await prisma.activityLog.count({ where: { sessionId } });

    // junk session: too short AND nothing happened -> don't keep it at all
    if (durationSec < MIN_SESSION_SEC && activityCount === 0) {
      await prisma.userSession.delete({ where: { id: sessionId } });
    } else {
      await prisma.userSession.update({
        where: { id: sessionId },
        data: { isOnline: false, logoutAt: seenAt, lastSeenAt: seenAt, durationSec },
      });
    }

    liveSessions.delete(adminId);

    const admin = await adminForPresence(adminId);
    if (admin) {
      await emitPresence(io, admin, {
        adminId,
        name: admin.name,
        role: admin.role,
        isOnline: false,
        sessionId,
        at: seenAt,
      });
    }
  } catch (e) {
    console.error("closeSession failed:", e.message);
    liveSessions.delete(adminId);
  }
};

// ---------------------------------------------------------------
// call once from initSocket()  ->  registerPresence(io, socket)
// ---------------------------------------------------------------
export const registerPresence = (io, socket) => {
  const adminId = socket.handshake.auth?.adminId;
  if (!adminId) return;

  // ---- CONNECT ----
  (async () => {
    try {
      // they were about to be marked offline — cancel that
      const timer = pendingOffline.get(adminId);
      if (timer) { clearTimeout(timer); pendingOffline.delete(adminId); }

      const existing = sockets.get(adminId);
      if (existing) {                       // another tab, same session
        existing.add(socket.id);
        socket.join(`admin:${adminId}`);
        return;
      }
      sockets.set(adminId, new Set([socket.id]));
      socket.join(`admin:${adminId}`);

      // 1) still inside the grace window -> resume silently, no event
      if (liveSessions.get(adminId)) {
        await prisma.userSession.update({
          where: { id: liveSessions.get(adminId) },
          data: { lastSeenAt: new Date() },
        }).catch(() => { });
        return;
      }

      const admin = await adminForPresence(adminId);
      if (!admin) return;

      // 2) an open session left behind by a restart, still fresh -> resume it
      const resumable = await prisma.userSession.findFirst({
        where: {
          adminId,
          isOnline: true,
          lastSeenAt: { gte: new Date(Date.now() - GRACE_MS) },
        },
        orderBy: { loginAt: "desc" },
      });

      let session = resumable;
      if (session) {
        await prisma.userSession.update({
          where: { id: session.id },
          data: { lastSeenAt: new Date(), logoutAt: null, isOnline: true },
        });
      } else {
        // 3) genuinely new session
        session = await prisma.userSession.create({
          data: {
            adminId,
            clientId: admin.clientId,
            role: admin.role,
            ip: socket.handshake.address || null,
            userAgent: socket.handshake.headers?.["user-agent"] || null,
          },
        });
      }

      liveSessions.set(adminId, session.id);

      await emitPresence(io, admin, {
        adminId,
        name: admin.name,
        role: admin.role,
        isOnline: true,
        sessionId: session.id,
        at: session.loginAt,
      });
    } catch (e) {
      console.error("presence online failed:", e.message);
    }
  })();

  // ---- DISCONNECT (start grace timer, do NOT close yet) ----
  socket.on("disconnect", async () => {
    try {
      const set = sockets.get(adminId);
      if (!set) return;
      set.delete(socket.id);
      if (set.size > 0) return;             // other tabs still open

      sockets.delete(adminId);

      const sessionId = liveSessions.get(adminId);
      if (!sessionId) return;

      const seenAt = new Date();
      await prisma.userSession.update({
        where: { id: sessionId },
        data: { lastSeenAt: seenAt },
      }).catch(() => { });

      const timer = setTimeout(() => closeSession(io, adminId, sessionId, seenAt), GRACE_MS);
      timer.unref?.();
      pendingOffline.set(adminId, timer);
    } catch (e) {
      console.error("presence offline failed:", e.message);
    }
  });
};

// ---------------------------------------------------------------
// heartbeat + crash recovery
// ---------------------------------------------------------------
export const startPresenceHeartbeat = () => {
  const t = setInterval(async () => {
    const ids = [...liveSessions.values()];
    if (!ids.length) return;
    try {
      await prisma.userSession.updateMany({
        where: { id: { in: ids } },
        data: { lastSeenAt: new Date() },
      });
    } catch (e) {
      console.error("presence heartbeat failed:", e.message);
    }
  }, 60_000);
  t.unref?.();
};

/** run on server boot — closes (or discards) sessions left hanging by a crash */
export const closeStaleSessions = async () => {
  try {
    const stale = await prisma.userSession.findMany({ where: { isOnline: true } });
    let closed = 0, dropped = 0;

    for (const s of stale) {
      const seenAt = new Date(s.lastSeenAt);
      const durationSec = Math.max(0, Math.round((seenAt - new Date(s.loginAt)) / 1000));
      const activityCount = await prisma.activityLog.count({ where: { sessionId: s.id } });

      if (durationSec < MIN_SESSION_SEC && activityCount === 0) {
        await prisma.userSession.delete({ where: { id: s.id } });
        dropped++;
      } else {
        await prisma.userSession.update({
          where: { id: s.id },
          data: { isOnline: false, logoutAt: seenAt, durationSec },
        });
        closed++;
      }
    }
    if (closed || dropped)
      console.log(`🧹 sessions: ${closed} closed, ${dropped} discarded as junk`);
  } catch (e) {
    console.error("closeStaleSessions failed:", e.message);
  }
};

/** online = has a live socket OR is inside the grace window */
export const getOnlineAdminIds = () => [
  ...new Set([...sockets.keys(), ...pendingOffline.keys()]),
];