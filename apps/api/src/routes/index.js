/**
 * routes/index.js — API route definitions.
 *
 * Mounts every endpoint the server exposes:
 *
 *   GET  /healthz  → Health-check (returns { status: "ok" }).
 *   GET  /config   → Public app config (Supabase keys, limits, upgrade URL).
 *   POST /merge    → Merge multiple PDFs into one.
 *   POST /convert  → Convert PNG/JPEG images into a single PDF.
 *   POST /edit     → Edit a single PDF (reorder, rotate, delete pages, watermark, etc.).
 *
 * The POST endpoints share a common middleware pipeline:
 *   1. limiter      – IP-based rate-limiter (30 req / min).
 *   2. attachReqId  – Attaches a UUID to `req.id` for request tracing.
 *   3. upload       – Multer file upload (memory storage, MIME + size checks).
 *   4. usageGate    – Enforces free-tier usage limits (server-side for authed
 *                     users via Supabase RPC, in-memory for anonymous users).
 *   5. controller   – The actual PDF operation handler.
 */
"use strict";

const express = require("express");
const { MAX_FILES } = require("../config");
const upload = require("../middleware/upload");
const attachReqId = require("../middleware/reqId");
const { limiter } = require("../middleware/security");
const usageGate = require("../middleware/usageGate");
const meta = require("../controllers/metaController");
const pdf = require("../controllers/pdfController");

const router = express.Router();

// ---- Read-only endpoints (no file upload, no usage gate) ----
router.get("/healthz", meta.getHealth);
router.get("/config", meta.getConfig);

// ---- PDF operation endpoints ----
router.post(
  "/merge",
  limiter, attachReqId, upload.array("files", MAX_FILES), usageGate,
  pdf.merge,
);

router.post(
  "/convert",
  limiter, attachReqId, upload.array("files", MAX_FILES), usageGate,
  pdf.convert,
);

router.post(
  "/edit",
  limiter, attachReqId, upload.array("files", 1), usageGate,
  pdf.edit,
);

module.exports = router;
