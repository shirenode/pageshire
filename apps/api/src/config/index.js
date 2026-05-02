"use strict";

require("dotenv").config();

const PORT = Number(process.env.PORT) || 3000;
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES) || 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = Number(process.env.MAX_TOTAL_BYTES) || 200 * 1024 * 1024;
const MAX_FILES = Number(process.env.MAX_FILES) || 50;
const FREE_MERGE_LIMIT = Number(process.env.FREE_MERGE_LIMIT) || 2;
const USAGE_WINDOW_HOURS = Number(process.env.USAGE_WINDOW_HOURS) || 24;
const MAX_PAGES_PER_FILE = Number(process.env.MAX_PAGES_PER_FILE) || 2000;
const MAX_PAGES_PER_REQUEST = Number(process.env.MAX_PAGES_PER_REQUEST) || 5000;
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const UPGRADE_URL = process.env.UPGRADE_URL || "";

const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);

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
