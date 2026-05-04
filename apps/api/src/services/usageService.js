/**
 * usageService.js — In-memory usage tracking for anonymous (unauthenticated) users.
 *
 * Because anonymous users have no database record, their usage is tracked
 * server-side in a Map keyed by a SHA-256 hash of (IP + User-Agent).
 *
 * Each entry stores:
 *  - count:       Number of operations performed in the current window.
 *  - windowStart: Timestamp (ms) when the window opened.
 *
 * Once the rolling window expires, the entry is lazily reset on the next
 * request. A periodic setInterval also prunes stale entries every hour
 * to avoid unbounded memory growth.
 *
 * Exports:
 *  - anonKey(req)        → A deterministic, privacy-safe identifier for the caller.
 *  - consumeAnon(key)    → Atomically checks and increments the counter;
 *                           returns { allowed, used, remaining, resetsAt }.
 */
"use strict";

const crypto = require("crypto");
const { FREE_MERGE_LIMIT, USAGE_WINDOW_HOURS } = require("../config");

/** In-memory store: key (SHA-256 hex) → { count, windowStart } */
const anonUsage = new Map();

/**
 * Derive a deterministic, privacy-safe key for an anonymous caller
 * by hashing their IP address and User-Agent string.
 */
function anonKey(req) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const ua = req.get("user-agent") || "";
  return crypto.createHash("sha256").update(`${ip}|${ua}`).digest("hex");
}

/**
 * Check whether the anonymous caller identified by `key` is allowed to
 * perform another operation. If yes, atomically increment their counter.
 *
 * @param {string} key - Hash returned by anonKey().
 * @returns {{ allowed: boolean, used: number, remaining: number, resetsAt: Date }}
 */
function consumeAnon(key) {
  const windowMs = USAGE_WINDOW_HOURS * 3600 * 1000;
  const now = Date.now();
  const entry = anonUsage.get(key);

  // First request or window expired — start a fresh window.
  if (!entry || now - entry.windowStart >= windowMs) {
    anonUsage.set(key, { count: 1, windowStart: now });
    return { allowed: true, used: 1, remaining: FREE_MERGE_LIMIT - 1, resetsAt: new Date(now + windowMs) };
  }

  // Quota exhausted within the current window.
  if (entry.count >= FREE_MERGE_LIMIT) {
    return { allowed: false, used: entry.count, remaining: 0, resetsAt: new Date(entry.windowStart + windowMs) };
  }

  // Still within quota — increment and allow.
  entry.count += 1;
  return {
    allowed: true,
    used: entry.count,
    remaining: FREE_MERGE_LIMIT - entry.count,
    resetsAt: new Date(entry.windowStart + windowMs),
  };
}

// Periodic cleanup: remove entries whose window has fully expired.
// Runs every hour; .unref() ensures it doesn't keep the process alive.
setInterval(() => {
  const cutoff = Date.now() - USAGE_WINDOW_HOURS * 3600 * 1000;
  for (const [k, v] of anonUsage) if (v.windowStart < cutoff) anonUsage.delete(k);
}, 60 * 60 * 1000).unref();

module.exports = { anonKey, consumeAnon };
