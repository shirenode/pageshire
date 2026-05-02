"use strict";

const { FREE_MERGE_LIMIT, USAGE_WINDOW_HOURS } = require("../config");
const { supabaseForRequest } = require("../services/supabaseService");
const { anonKey, consumeAnon } = require("../services/usageService");
const { logError } = require("../utils/logger");

async function usageGate(req, res, next) {
  try {
    const userClient = supabaseForRequest(req);
    if (userClient) {
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) {
        return res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
      }
      req.userClient = userClient;
      req.userId = userData.user.id;
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
        return res.status(402).json({
          error: `Free limit reached. Resets at ${row?.resets_at}. Upgrade to Pro for unlimited usage.`,
          resetsAt: row?.resets_at,
          remaining: 0,
        });
      }
      return next();
    }

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
