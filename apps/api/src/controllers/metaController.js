"use strict";

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  FREE_MERGE_LIMIT,
  USAGE_WINDOW_HOURS,
  UPGRADE_URL,
} = require("../config");

function getHealth(_req, res) {
  res.json({ status: "ok", uptime: process.uptime() });
}

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
