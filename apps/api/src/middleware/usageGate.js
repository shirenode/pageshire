/**
 * usageGate.js — Usage / paywall enforcement middleware.
 *
 * Sits between the upload middleware and the PDF controller. Its job is
 * to decide whether the current request is allowed to proceed based on
 * the caller's usage quota:
 *
 *  1. **Authenticated users** — A Supabase client is created from the
 *     caller's JWT. The server calls the `consume_usage` RPC (a Postgres
 *     function that atomically checks + increments the counter). If the
 *     user has exceeded their free tier, a 402 (Payment Required) is
 *     returned with the reset timestamp.
 *
 *  2. **Anonymous users** — Identified by a SHA-256 hash of their IP +
 *     User-Agent. An in-memory sliding-window counter (usageService)
 *     tracks how many operations they've performed. If the anonymous
 *     limit is hit, a 402 is returned prompting them to sign in or
 *     upgrade.
 */
"use strict";

const { FREE_MERGE_LIMIT, USAGE_WINDOW_HOURS } = require("../config");
const { supabaseForRequest } = require("../services/supabaseService");
const { anonKey, consumeAnon } = require("../services/usageService");
const { logError } = require("../utils/logger");

async function usageGate(req, res, next) {
  try {
    // Try to build a per-request Supabase client from the Authorization header.
    const userClient = supabaseForRequest(req);

    if (userClient) {
      // ---- Authenticated path ----
      // Verify the JWT is still valid.
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) {
        return res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
      }
      // Attach the client + user ID to the request so downstream handlers
      // can use them (e.g. for logging operations to the user's history).
      req.userClient = userClient;
      req.userId = userData.user.id;

      // Atomically check-and-consume one usage credit via Supabase RPC.
      const { data, error } = await userClient.rpc("consume_usage", {
        limit_count: FREE_MERGE_LIMIT,
        window_hours: USAGE_WINDOW_HOURS,
      });
      if (error) {
        logError(req.id, "consume_usage", error);
        return res.status(500).json({ error: "Could not verify usage limits." });
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.allowed) {
        // Free quota exhausted — ask the user to upgrade.
        return res.status(402).json({
          error: `Free limit reached. Resets at ${row?.resets_at}. Upgrade to Pro for unlimited usage.`,
          resetsAt: row?.resets_at,
          remaining: 0,
        });
      }
      return next();
    }

    // ---- Anonymous path ----
    // No JWT → track usage by hashed IP + User-Agent in server memory.
    const result = consumeAnon(anonKey(req));
    if (!result.allowed) {
      return res.status(402).json({
        error: `Free limit reached. Sign in to get more, or upgrade to Pro. Resets at ${result.resetsAt.toISOString()}.`,
        resetsAt: result.resetsAt.toISOString(),
        remaining: 0,
      });
    }
    next();
  } catch (err) {
    logError(req.id, "usageGate", err);
    res.status(500).json({ error: "Usage check failed." });
  }
}

module.exports = usageGate;
