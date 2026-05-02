"use strict";

const { createClient } = require("@supabase/supabase-js");
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require("../config");
const { logError } = require("../utils/logger");

// Build a per-request Supabase client bound to the caller's JWT (or null).
function supabaseForRequest(req) {
  const auth = req.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Fire-and-forget operation log.
async function logOp(req, opType, { fileCount = 0, pageCount = 0, bytesIn = 0, bytesOut = 0 } = {}) {
  const client = req.userClient;
  if (!client) return;
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
