/**
 * metaController.js — Lightweight informational endpoints.
 *
 * Exposes:
 *  - GET /healthz  → Returns { status: "ok", uptime } for uptime monitors.
 *  - GET /config   → Returns the public-facing app configuration that the
 *                     web frontend needs at startup (Supabase URL/anon key,
 *                     free-tier limits, upgrade URL). This avoids hard-coding
 *                     environment-specific values in the static HTML.
 */
"use strict";

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  FREE_MERGE_LIMIT,
  USAGE_WINDOW_HOURS,
  UPGRADE_URL,
} = require("../config");

/**
 * Health-check handler. Used by load balancers / monitoring tools
 * to confirm the service is alive.
 */
function getHealth(_req, res) {
  res.json({ status: "ok", uptime: process.uptime() });
}

/**
 * Serves the public app configuration to the frontend.
 * The web client fetches this on page load to initialise the
 * Supabase client and know the current usage limits.
 */
function getConfig(_req, res) {
  res.json({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    freeMergeLimit: FREE_MERGE_LIMIT,
    usageWindowHours: USAGE_WINDOW_HOURS,
    upgradeUrl: UPGRADE_URL,
  });
}

module.exports = { getHealth, getConfig };
