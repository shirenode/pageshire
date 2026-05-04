/**
 * config/index.js — Centralised configuration.
 *
 * Loads environment variables from the repo-root .env file (via dotenv) and
 * exports every tuneable constant used across the application.
 *
 * Key settings:
 *  - PORT:              HTTP port for the Express server.
 *  - MAX_FILE_BYTES:    Per-file upload size limit (default 50 MB).
 *  - MAX_TOTAL_BYTES:   Total combined upload size limit (default 200 MB).
 *  - MAX_FILES:         Max number of files in a single request.
 *  - FREE_MERGE_LIMIT:  How many free operations anonymous/free users get per window.
 *  - USAGE_WINDOW_HOURS:Rolling window (in hours) for the free-tier limit.
 *  - MAX_PAGES_PER_FILE / MAX_PAGES_PER_REQUEST: Page-count guardrails.
 *  - SUPABASE_URL / SUPABASE_ANON_KEY: Auth & database connectivity.
 *  - UPGRADE_URL:       Link to the payment/upgrade page (e.g. Stripe Checkout).
 *  - ALLOWED_MIME:      Set of MIME types accepted by the upload middleware.
 *  - PAGE_SIZES:        Named page dimensions for the image-to-PDF converter.
 */
"use strict";

const path = require("path");
// Load .env from the repo root so the workspace runs from any cwd.
require("dotenv").config({ path: path.resolve(__dirname, "../../../../.env") });

// ---- Server ----
const PORT = Number(process.env.PORT) || 3000;

// ---- Upload limits ----
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES) || 50 * 1024 * 1024;  // 50 MB per file
const MAX_TOTAL_BYTES = Number(process.env.MAX_TOTAL_BYTES) || 200 * 1024 * 1024; // 200 MB total
const MAX_FILES = Number(process.env.MAX_FILES) || 50;

// ---- Usage / rate limits ----
const FREE_MERGE_LIMIT = Number(process.env.FREE_MERGE_LIMIT) || 2;
const USAGE_WINDOW_HOURS = Number(process.env.USAGE_WINDOW_HOURS) || 24;

// ---- Page count safety caps ----
const MAX_PAGES_PER_FILE = Number(process.env.MAX_PAGES_PER_FILE) || 2000;
const MAX_PAGES_PER_REQUEST = Number(process.env.MAX_PAGES_PER_REQUEST) || 5000;

// ---- Supabase (auth + database) ----
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

// ---- Payment / upgrade ----
const UPGRADE_URL = process.env.UPGRADE_URL || "";

// MIME types the server will accept for upload (PDF and images).
const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);

/**
 * Named page dimensions (in PDF points, 1 pt = 1/72 inch).
 * "fit" means the output page matches the image's native size.
 */
const PAGE_SIZES = {
  fit: null,
  a4: [595.28, 841.89],
  letter: [612, 792],
};

module.exports = {
  PORT,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_FILES,
  FREE_MERGE_LIMIT,
  USAGE_WINDOW_HOURS,
  MAX_PAGES_PER_FILE,
  MAX_PAGES_PER_REQUEST,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  UPGRADE_URL,
  ALLOWED_MIME,
  PAGE_SIZES,
};
