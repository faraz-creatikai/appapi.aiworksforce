// src/controllers/activity.controller.js

import { getVisibleAdminIds, scopeWhere } from "../utils/activityLogger.js";
import { getOnlineAdminIds } from "../socket/presence.js";
import ApiError from "../utils/ApiError.js";
import prisma from "../config/prismaClient.js";

const ADMIN_SELECT = { id: true, name: true, email: true, role: true, city: true, clientId: true };

/** build date range from ?from=YYYY-MM-DD&to=YYYY-MM-DD (defaults: last 30 days) */
const dateRange = (q) => {
  const to = q.to ? new Date(q.to) : new Date();
  to.setHours(23, 59, 59, 999);
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 29 * 86400000);
  from.setHours(0, 0, 0, 0);
  return { from, to };
};

// ---------------------------------------------------------------
// GET /api/activity/feed
// ?page&limit&adminId&entity&action&customerId&search&from&to
// ---------------------------------------------------------------
export const getActivityFeed = async (req, res, next) => {
  try {
    const visible = await getVisibleAdminIds(req.admin);
    if (Array.isArray(visible) && visible.length === 0)
      return next(new ApiError(403, "You do not have access to activity reports"));

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 25);
    const { from, to } = dateRange(req.query);

    const where = {
      ...scopeWhere(visible, req.query.adminId),
      createdAt: { gte: from, lte: to },
      ...(req.query.entity && { entity: req.query.entity }),
      ...(req.query.action && { action: req.query.action }),
      ...(req.query.customerId && { customerId: req.query.customerId }),
      ...(req.query.sessionId && { sessionId: req.query.sessionId }),
      ...(req.query.search && {
        OR: [
          { entityName: { contains: req.query.search } },
          { admin: { name: { contains: req.query.search } } },
        ],
      }),
    };

    const [total, rows] = await Promise.all([
      prisma.activityLog.count({ where }),
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          admin: { select: ADMIN_SELECT },
          targetAdminRef: { select: ADMIN_SELECT },
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        entityName: r.entityName,
        customerId: r.customerId,
        followupId: r.followupId,
        sessionId: r.sessionId,
        meta: r.meta,
        createdAt: r.createdAt,
        admin: r.admin,
        target: r.targetAdminRef,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------------------
// GET /api/activity/summary   -> per-user counts + online time
// ?adminId&from&to
// ---------------------------------------------------------------
export const getActivitySummary = async (req, res, next) => {
  try {
    const visible = await getVisibleAdminIds(req.admin);
    if (Array.isArray(visible) && visible.length === 0)
      return next(new ApiError(403, "You do not have access to activity reports"));

    const { from, to } = dateRange(req.query);
    const scope = scopeWhere(visible, req.query.adminId);
    const where = { ...scope, createdAt: { gte: from, lte: to } };

    const [grouped, sessions] = await Promise.all([
      prisma.activityLog.groupBy({
        by: ["adminId", "entity", "action"],
        where,
        _count: { _all: true },
      }),
      prisma.userSession.findMany({
        where: { ...scope, loginAt: { gte: from, lte: to } },
        select: { adminId: true, durationSec: true, isOnline: true, loginAt: true },
      }),
    ]);

    const adminIds = [...new Set([...grouped.map((g) => g.adminId), ...sessions.map((s) => s.adminId)])];
    const admins = await prisma.admin.findMany({ where: { id: { in: adminIds } }, select: ADMIN_SELECT });
    const onlineNow = new Set(getOnlineAdminIds());

    const map = new Map(
      admins.map((a) => [
        a.id,
        { user: a, isOnline: onlineNow.has(a.id), totalActivities: 0, onlineSeconds: 0, sessionCount: 0, counts: {} },
      ])
    );

    for (const g of grouped) {
      const row = map.get(g.adminId);
      if (!row) continue;
      row.counts[g.entity] = row.counts[g.entity] || {};
      row.counts[g.entity][g.action] = g._count._all;
      row.totalActivities += g._count._all;
    }

    const now = Date.now();
    for (const s of sessions) {
      const row = map.get(s.adminId);
      if (!row) continue;
      row.sessionCount += 1;
      row.onlineSeconds += s.durationSec ?? (s.isOnline ? Math.round((now - new Date(s.loginAt)) / 1000) : 0);
    }

    const data = [...map.values()].sort((a, b) => b.totalActivities - a.totalActivities);

    const totals = data.reduce(
      (acc, r) => {
        acc.activities += r.totalActivities;
        acc.onlineSeconds += r.onlineSeconds;
        return acc;
      },
      { users: data.length, activities: 0, onlineSeconds: 0 }
    );

    res.status(200).json({ success: true, range: { from, to }, totals, data });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------------------
// GET /api/activity/timeline/:adminId  -> online/offline sessions
// with the activities done inside each session
// ---------------------------------------------------------------
export const getUserTimeline = async (req, res, next) => {
  try {
    const visible = await getVisibleAdminIds(req.admin);
    const { adminId } = req.params;

    if (Array.isArray(visible) && !visible.includes(adminId))
      return next(new ApiError(403, "You cannot view this user's activity"));

    const { from, to } = dateRange(req.query);

    const [user, sessions, logs] = await Promise.all([
      prisma.admin.findUnique({ where: { id: adminId }, select: ADMIN_SELECT }),
      prisma.userSession.findMany({
        where: { adminId, loginAt: { gte: from, lte: to } },
        orderBy: { loginAt: "desc" },
      }),
      prisma.activityLog.findMany({
        where: { adminId, createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: "desc" },
        include: { targetAdminRef: { select: ADMIN_SELECT } },
      }),
    ]);

    if (!user) return next(new ApiError(404, "User not found"));

    const bySession = new Map();
    const unlinked = [];
    for (const l of logs) {
      if (!l.sessionId) { unlinked.push(l); continue; }
      if (!bySession.has(l.sessionId)) bySession.set(l.sessionId, []);
      bySession.get(l.sessionId).push(l);
    }

    const now = Date.now();
    const timeline = sessions.map((s) => {
      const acts = bySession.get(s.id) || [];
      const counts = {};
      for (const a of acts) {
        const key = `${a.entity}_${a.action}`;
        counts[key] = (counts[key] || 0) + 1;
      }
      return {
        sessionId: s.id,
        loginAt: s.loginAt,
        logoutAt: s.logoutAt,
        isOnline: s.isOnline,
        durationSec: s.durationSec ?? (s.isOnline ? Math.round((now - new Date(s.loginAt)) / 1000) : 0),
        ip: s.ip,
        totalActivities: acts.length,
        counts,
        activities: acts,
      };
    });

    res.status(200).json({
      success: true,
      user,
      isOnline: getOnlineAdminIds().includes(adminId),
      range: { from, to },
      timeline,
      unlinkedActivities: unlinked, // done while not connected on socket
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------------------
// GET /api/activity/users  -> list for the filter dropdown
// (also returns who is online right now)
// ---------------------------------------------------------------
export const getActivityUsers = async (req, res, next) => {
  try {
    const visible = await getVisibleAdminIds(req.admin);
    if (Array.isArray(visible) && visible.length === 0)
      return next(new ApiError(403, "You do not have access to activity reports"));

    const users = await prisma.admin.findMany({
      where: visible === null ? {} : { id: { in: visible } },
      select: ADMIN_SELECT,
      orderBy: { name: "asc" },
    });

    const online = new Set(getOnlineAdminIds());
    res.status(200).json({
      success: true,
      data: users.map((u) => ({ ...u, isOnline: online.has(u.id) })),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};



// ===============================================================
// APPEND THESE 3 HANDLERS TO src/controllers/activity.controller.js
// (same imports as the file already has)
// ===============================================================

// ---------------------------------------------------------------
// GET /api/activity/customers
// Every customer touched in the range + what was done to it.
// ?page&limit&adminId&action&search&from&to
// ---------------------------------------------------------------
export const getTouchedCustomers = async (req, res, next) => {
  try {
    const visible = await getVisibleAdminIds(req.admin);
    if (Array.isArray(visible) && visible.length === 0)
      return next(new ApiError(403, "You do not have access to activity reports"));

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const { from, to } = dateRange(req.query);

    const where = {
      ...scopeWhere(visible, req.query.adminId),
      entity: "customer",
      customerId: { not: null },
      createdAt: { gte: from, lte: to },
      ...(req.query.action && { action: req.query.action }),
      ...(req.query.search && { entityName: { contains: req.query.search } }),
    };

    // distinct customers, newest activity first
    const [groups, distinct] = await Promise.all([
      prisma.activityLog.groupBy({
        by: ["customerId"],
        where,
        _count: { _all: true },
        _max: { createdAt: true },
        orderBy: { _max: { createdAt: "desc" } },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.activityLog.groupBy({ by: ["customerId"], where, _count: { _all: true } }),
    ]);

    const ids = groups.map((g) => g.customerId);

    const [breakdown, customers, lastLogs] = await Promise.all([
      ids.length
        ? prisma.activityLog.groupBy({
            by: ["customerId", "action"],
            where: { ...where, customerId: { in: ids } },
            _count: { _all: true },
          })
        : [],
      ids.length
        ? prisma.customer.findMany({
            where: { id: { in: ids } },
            select: {
              id: true, customerName: true, ContactNumber: true, City: true,
              Campaign: true, CustomerType: true, LeadType: true, Price: true,
              LeadTemperature: true, DealClosed: true, createdAt: true,
            },
          })
        : [],
      ids.length
        ? prisma.activityLog.findMany({
            where: { ...where, customerId: { in: ids } },
            orderBy: { createdAt: "desc" },
            distinct: ["customerId"],
            include: { admin: { select: ADMIN_SELECT } },
          })
        : [],
    ]);

    const liveMap = new Map(customers.map((c) => [c.id, c]));
    const lastMap = new Map(lastLogs.map((l) => [l.customerId, l]));
    const actionMap = new Map();
    for (const b of breakdown) {
      const m = actionMap.get(b.customerId) || {};
      m[b.action] = b._count._all;
      actionMap.set(b.customerId, m);
    }

    const data = groups.map((g) => {
      const live = liveMap.get(g.customerId) || null;
      const last = lastMap.get(g.customerId) || null;
      return {
        customerId: g.customerId,
        isDeleted: !live,                                  // no longer in DB
        customerName: live?.customerName || last?.entityName || "Unknown",
        contact: live?.ContactNumber || last?.meta?.contact || null,
        city: live?.City || last?.meta?.city || null,
        campaign: live?.Campaign || last?.meta?.campaign || null,
        leadType: live?.LeadType || null,
        price: live?.Price || null,
        leadTemperature: live?.LeadTemperature || null,
        dealClosed: live?.DealClosed ?? false,
        totalActivities: g._count._all,
        lastActivityAt: g._max.createdAt,
        lastAction: last?.action || null,
        lastBy: last?.admin || null,
        counts: actionMap.get(g.customerId) || {},
      };
    });

    const total = distinct.length;
    res.status(200).json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------------------
// GET /api/activity/followups
// Every follow-up touched in the range.
// ---------------------------------------------------------------
export const getTouchedFollowups = async (req, res, next) => {
  try {
    const visible = await getVisibleAdminIds(req.admin);
    if (Array.isArray(visible) && visible.length === 0)
      return next(new ApiError(403, "You do not have access to activity reports"));

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const { from, to } = dateRange(req.query);

    const where = {
      ...scopeWhere(visible, req.query.adminId),
      entity: "followup",
      followupId: { not: null },
      createdAt: { gte: from, lte: to },
      ...(req.query.action && { action: req.query.action }),
      ...(req.query.search && { entityName: { contains: req.query.search } }),
    };

    const [groups, distinct] = await Promise.all([
      prisma.activityLog.groupBy({
        by: ["followupId"],
        where,
        _count: { _all: true },
        _max: { createdAt: true },
        orderBy: { _max: { createdAt: "desc" } },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.activityLog.groupBy({ by: ["followupId"], where, _count: { _all: true } }),
    ]);

    const ids = groups.map((g) => g.followupId);

    const [followups, lastLogs] = await Promise.all([
      ids.length
        ? prisma.followup.findMany({
            where: { id: { in: ids } },
            include: { customer: { select: { id: true, customerName: true, ContactNumber: true, City: true } } },
          })
        : [],
      ids.length
        ? prisma.activityLog.findMany({
            where: { ...where, followupId: { in: ids } },
            orderBy: { createdAt: "desc" },
            distinct: ["followupId"],
            include: { admin: { select: ADMIN_SELECT } },
          })
        : [],
    ]);

    const liveMap = new Map(followups.map((f) => [f.id, f]));
    const lastMap = new Map(lastLogs.map((l) => [l.followupId, l]));

    const data = groups.map((g) => {
      const live = liveMap.get(g.followupId) || null;
      const last = lastMap.get(g.followupId) || null;
      return {
        followupId: g.followupId,
        isDeleted: !live,
        customerId: live?.customerId || last?.customerId || null,
        customerName: live?.customer?.customerName || last?.entityName || "Unknown",
        contact: live?.customer?.ContactNumber || null,
        city: live?.customer?.City || null,
        StatusType: live?.StatusType || last?.meta?.StatusType || null,
        StartDate: live?.StartDate || null,
        FollowupNextDate: live?.FollowupNextDate || last?.meta?.FollowupNextDate || null,
        Description: live?.Description || null,
        totalActivities: g._count._all,
        lastActivityAt: g._max.createdAt,
        lastAction: last?.action || null,
        lastBy: last?.admin || null,
      };
    });

    const total = distinct.length;
    res.status(200).json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------------------
// GET /api/activity/record/:entity/:id      entity = customer | followup
// Full snapshot for the preview drawer + that record's own history.
// Access rule: the record must appear in a log this admin can see.
// ---------------------------------------------------------------
export const getRecordDetail = async (req, res, next) => {
  try {
    const { entity, id } = req.params;
    if (!["customer", "followup"].includes(entity))
      return next(new ApiError(400, "entity must be customer or followup"));

    const visible = await getVisibleAdminIds(req.admin);
    if (Array.isArray(visible) && visible.length === 0)
      return next(new ApiError(403, "You do not have access to activity reports"));

    const idKey = entity === "customer" ? "customerId" : "followupId";

    const history = await prisma.activityLog.findMany({
      where: { ...scopeWhere(visible, null), [idKey]: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        admin: { select: ADMIN_SELECT },
        targetAdminRef: { select: ADMIN_SELECT },
      },
    });

    if (history.length === 0)
      return next(new ApiError(403, "This record is not in your activity scope"));

    let record = null;

    if (entity === "customer") {
      const c = await prisma.customer.findUnique({
        where: { id },
        include: {
          AssignTo: { select: ADMIN_SELECT },
          CreatedBy: { select: ADMIN_SELECT },
          _count: { select: { followups: true, callLogs: true } },
        },
      });
      if (c) {
        record = {
          id: c.id,
          customerName: c.customerName,
          ContactNumber: c.ContactNumber,
          Email: c.Email,
          City: c.City,
          Location: c.Location,
          Area: c.Area,
          Adderess: c.Adderess,
          Campaign: c.Campaign,
          CustomerType: c.CustomerType,
          CustomerSubType: c.CustomerSubType,
          LeadType: c.LeadType,
          LeadTemperature: c.LeadTemperature,
          DealClosed: c.DealClosed,
          Price: c.Price,
          Description: c.Description,
          assignedTo: c.AssignTo,
          createdBy: c.CreatedBy,
          followupCount: c._count.followups,
          callLogCount: c._count.callLogs,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        };
      }
    } else {
      const f = await prisma.followup.findUnique({
        where: { id },
        include: {
          customer: { select: { id: true, customerName: true, ContactNumber: true, City: true } },
          CreatedBy: { select: ADMIN_SELECT },
        },
      });
      if (f) {
        record = {
          id: f.id,
          customerId: f.customerId,
          customer: f.customer,
          StartDate: f.StartDate,
          StatusType: f.StatusType,
          FollowupNextDate: f.FollowupNextDate,
          Description: f.Description,
          createdBy: f.CreatedBy,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
        };
      }
    }

    res.status(200).json({
      success: true,
      entity,
      isDeleted: !record,
      record,                              // null when the record was deleted
      snapshot: history.find((h) => h.action === "delete")?.meta ?? null,
      history,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};


// ===============================================================
// ADD TO src/routes/activity.routes.js
// ===============================================================
// import { getTouchedCustomers, getTouchedFollowups, getRecordDetail } from "...";
//
// router.get("/customers", getTouchedCustomers);
// router.get("/followups", getTouchedFollowups);
// router.get("/record/:entity/:id", getRecordDetail);