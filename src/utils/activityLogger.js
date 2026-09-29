// src/utils/activityLogger.js
// ---------------------------------------------------------------
// Single place for: writing activity logs + role-based visibility.
// ---------------------------------------------------------------

import prisma from "../config/prismaClient.js";


/** in-memory: adminId -> current open sessionId (filled by socket/presence.js) */
export const liveSessions = new Map();

const adminIdOf = (admin) => admin?.id || admin?._id || null;

// ---------------------------------------------------------------
// WRITE A LOG  (never throws, never blocks your response)
// ---------------------------------------------------------------
export const logActivity = ({
  admin,
  action,          // "create" | "update" | "delete" | "assign" | "unassign"
  entity,          // "customer" | "followup" | ...
  entityId,
  entityName,
  customerId,
  followupId,
  targetAdminId,
  meta = {},
  req,
}) => {
  const adminId = adminIdOf(admin);
  if (!adminId) return Promise.resolve();

  return (async () => {
    try {
      let sessionId = liveSessions.get(adminId) || null;

      // not connected on socket right now -> attach to last open session if any
      if (!sessionId) {
        const open = await prisma.userSession.findFirst({
          where: { adminId, isOnline: true },
          orderBy: { loginAt: "desc" },
          select: { id: true },
        });
        sessionId = open?.id || null;
      }

      await prisma.activityLog.create({
        data: {
          adminId,
          role: admin.role || null,
          city: admin.city || null,
          clientId: admin.clientId || null,
          action,
          entity,
          entityId: entityId || null,
          entityName: entityName || null,
          customerId: customerId || null,
          followupId: followupId || null,
          targetAdminId: targetAdminId || null,
          sessionId,
          meta: {
            ...meta,
            ip: req?.ip || req?.headers?.["x-forwarded-for"] || undefined,
          },
        },
      });
    } catch (e) {
      console.error("activity log failed (non-fatal):", e.message);
    }
  })();
};

/** helper: which fields actually changed (used for update logs) */
export const diffFields = (before = {}, after = {}, ignore = []) => {
  const skip = new Set([
    "updatedAt", "createdAt", "CustomerFields", "CustomerImage", "SitePlan", ...ignore,
  ]);
  const changed = [];
  for (const key of Object.keys(after)) {
    if (skip.has(key)) continue;
    const a = before[key];
    const b = after[key];
    if (a === undefined || b === undefined) continue;
    if (String(a ?? "") !== String(b ?? "")) changed.push(key);
  }
  return changed;
};

// ---------------------------------------------------------------
// ROLE VISIBILITY
// returns:  null  -> can see EVERYONE (super admin)
//           []    -> no access at all
//           [ids] -> only these admin ids
// ---------------------------------------------------------------
export const getVisibleAdminIds = async (admin) => {
  const me = adminIdOf(admin);
  const role = admin?.role;

  if (admin?.isSuperAdmin) return null;                 // owner -> everything
  if (!role || role === "user" || role === "agent") return []; // no access

  let where = {};

  if (role === "client_admin") {
    where = { role: { in: ["administrator", "city_admin", "user", "agent"] } };
  } else if (role === "administrator") {
    where = { role: { in: ["city_admin", "user", "agent"] } };
  } else if (role === "city_admin") {
    // only the users/agents HE created
    where = { role: { in: ["user", "agent"] }, createdBy: me };
  } else {
    return [];
  }

  // stay inside own company
  if (admin.clientId) where.clientId = admin.clientId;

  const rows = await prisma.admin.findMany({ where, select: { id: true } });
  return [...new Set([me, ...rows.map((r) => r.id)])]; // always include self
};

/** build a prisma `where` fragment for adminId based on visibility */
export const scopeWhere = (visibleIds, requestedAdminId) => {
  if (visibleIds === null) {
    return requestedAdminId ? { adminId: requestedAdminId } : {};
  }
  if (requestedAdminId) {
    return { adminId: visibleIds.includes(requestedAdminId) ? requestedAdminId : "__none__" };
  }
  return { adminId: { in: visibleIds } };
};

// ---------------------------------------------------------------
// REVERSE LOOKUP — who is allowed to WATCH this admin's presence.
// Used by socket to emit online/offline only to permitted dashboards.
// ---------------------------------------------------------------
export const getViewerAdminIds = async (target) => {
  const targetId = adminIdOf(target);
  const or = [{ isSuperAdmin: true }];

  const sameClient = target.clientId ? { clientId: target.clientId } : {};

  if (["administrator", "city_admin", "user", "agent"].includes(target.role)) {
    or.push({ role: "client_admin", ...sameClient });
  }
  if (["city_admin", "user", "agent"].includes(target.role)) {
    or.push({ role: "administrator", ...sameClient });
  }
  if (["user", "agent"].includes(target.role) && target.createdBy) {
    or.push({ id: target.createdBy, role: "city_admin" });
  }

  const rows = await prisma.admin.findMany({ where: { OR: or }, select: { id: true } });
  return [...new Set([targetId, ...rows.map((r) => r.id)])];
};

// ---------------------------------------------------------------
// MIDDLEWARE — block `user` / `agent` from the whole report
// ---------------------------------------------------------------
export const requireActivityAccess = (req, res, next) => {
  const role = req.admin?.role;
  if (req.admin?.isSuperAdmin) return next();
  if (!role || role === "user" || role === "agent") {
    return res.status(403).json({ success: false, message: "You do not have access to activity reports" });
  }
  next();
};