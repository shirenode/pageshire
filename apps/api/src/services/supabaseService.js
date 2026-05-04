/**
 * supabaseService.js — Supabase client factory + operation logging.
 *
 * - supabaseForRequest(req): Creates a throwaway Supabase client scoped to
 *   the caller's JWT (extracted from the Authorization header). Returns null
 *   if no token is present or Supabase is not configured. This ensures
 *   every database call runs under the user's Row-Level-Security policies.
 *
 * - logOp(req, opType, stats): Fire-and-forget helper that records a
 *   completed operation (merge / convert / edit) to the `operations` table
 *   via the `log_operation` Postgres RPC. Failures are silently logged to
 *   the console — they must never break the main request flow.
 */
"use strict";

const { createClient } = require("@supabase/supabase-js");
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require("../config");
const { logError } = require("../utils/logger");

/**
 * Build a per-request Supabase client that inherits the caller's JWT.
 * Returns null when the request has no Bearer token or Supabase env vars
 * are missing (e.g. in local dev without a database).
 */
function supabaseForRequest(req) {
  const auth = req.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    // Disable session persistence — this client is ephemeral (one per request).
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Log a completed PDF operation to the user's history (fire-and-forget).
 * Only runs when the request was authenticated (req.userClient exists).
 */
async function logOp(req, opType, { fileCount = 0, pageCount = 0, bytesIn = 0, bytesOut = 0 } = {}) {
  const client = req.userClient;
  if (!client) return; // Anonymous request — nothing to log.
  try {
    await client.rpc("log_operation", {
      op_type: opType,
      file_count: fileCount,
      page_count: pageCount,
      bytes_in: bytesIn,
      bytes_out: bytesOut,
    });
  } catch (e) {
    logError(req.id, "log_operation", e);
  }
}

module.exports = { supabaseForRequest, logOp };
