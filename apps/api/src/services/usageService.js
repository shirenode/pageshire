"use strict";

const crypto = require("crypto");
const { FREE_MERGE_LIMIT, USAGE_WINDOW_HOURS } = require("../config");

const anonUsage = new Map();

function anonKey(req) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const ua = req.get("user-agent") || "";
  return crypto.createHash("sha256").update(`${ip}|${ua}`).digest("hex");
}

function consumeAnon(key) {
  const windowMs = USAGE_WINDOW_HOURS * 3600 * 1000;
  const now = Date.now();
  const entry = anonUsage.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    anonUsage.set(key, { count: 1, windowStart: now });
    return { allowed: true, used: 1, remaining: FREE_MERGE_LIMIT - 1, resetsAt: new Date(now + windowMs) };
  }
  if (entry.count >= FREE_MERGE_LIMIT) {
    return { allowed: false, used: entry.count, remaining: 0, resetsAt: new Date(entry.windowStart + windowMs) };
  }
  entry.count += 1;
  return {
    allowed: true,
    used: entry.count,
    remaining: FREE_MERGE_LIMIT - entry.count,
    resetsAt: new Date(entry.windowStart + windowMs),
  };
}

// Periodic cleanup.
setInterval(() => {
  const cutoff = Date.now() - USAGE_WINDOW_HOURS * 3600 * 1000;
  for (const [k, v] of anonUsage) if (v.windowStart < cutoff) anonUsage.delete(k);
}, 60 * 60 * 1000).unref();

module.exports = { anonKey, consumeAnon };
