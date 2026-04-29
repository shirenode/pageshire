require("dotenv").config();
const express = require("express");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { PDFDocument } = require("pdf-lib");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES) || 50 * 1024 * 1024; // 50 MB / file
const MAX_TOTAL_BYTES = Number(process.env.MAX_TOTAL_BYTES) || 200 * 1024 * 1024; // 200 MB / request
const MAX_FILES = Number(process.env.MAX_FILES) || 50;
const FREE_MERGE_LIMIT = Number(process.env.FREE_MERGE_LIMIT) || 2;
const USAGE_WINDOW_HOURS = Number(process.env.USAGE_WINDOW_HOURS) || 24;
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);

const PAGE_SIZES = {
  fit: null,
  a4: [595.28, 841.89],
  letter: [612, 792],
};

const app = express();
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'", ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : []), "https://*.supabase.co"],
        "upgrade-insecure-requests": null,
      },
    },
    strictTransportSecurity: false,
  })
);

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: MAX_FILES,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// Static frontend
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Public client config (Supabase URL + anon key are safe for the browser)
app.get("/config", (_req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    freeMergeLimit: Number(process.env.FREE_MERGE_LIMIT) || 2,
    usageWindowHours: Number(process.env.USAGE_WINDOW_HOURS) || 24,
    upgradeUrl: process.env.UPGRADE_URL || "",
  });
});

// --- Helpers ---
function sanitizeFilename(name, fallback) {
  if (typeof name !== "string") return fallback;
  const trimmed = name.trim().slice(0, 80);
  const cleaned = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

function totalSize(files) {
  return files.reduce((sum, f) => sum + f.size, 0);
}

function logError(reqId, label, err) {
  console.error(`[${reqId}] ${label}:`, err && err.stack ? err.stack : err);
}

function attachReqId(req, _res, next) {
  req.id = crypto.randomUUID();
  next();
}

// --- Usage gate middleware ---
// Authenticated users: validates JWT and calls Supabase RPC `consume_usage` as that user.
// Anonymous users: in-memory rolling counter keyed by IP+UA fingerprint.
const anonUsage = new Map(); // key -> { count, windowStart }

function anonKey(req) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const ua = req.get("user-agent") || "";
  return crypto.createHash("sha256").update(`${ip}|${ua}`).digest("hex");
}

function checkAnonUsage() {
  const windowMs = USAGE_WINDOW_HOURS * 3600 * 1000;
  return (key) => {
    const now = Date.now();
    const entry = anonUsage.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      anonUsage.set(key, { count: 1, windowStart: now });
      return { allowed: true, used: 1, remaining: FREE_MERGE_LIMIT - 1, resetsAt: new Date(now + windowMs) };
    }
    if (entry.count >= FREE_MERGE_LIMIT) {
      return { allowed: false, used: entry.count, remaining: 0, resetsAt: new Date(entry.windowStart + windowMs) };
    }
    entry.count += 1;
    return { allowed: true, used: entry.count, remaining: FREE_MERGE_LIMIT - entry.count, resetsAt: new Date(entry.windowStart + windowMs) };
  };
}
const consumeAnon = checkAnonUsage();

// Periodic cleanup of expired anon entries.
setInterval(() => {
  const cutoff = Date.now() - USAGE_WINDOW_HOURS * 3600 * 1000;
  for (const [k, v] of anonUsage) if (v.windowStart < cutoff) anonUsage.delete(k);
}, 60 * 60 * 1000).unref();

async function usageGate(req, res, next) {
  try {
    const auth = req.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (token && SUPABASE_URL && SUPABASE_ANON_KEY) {
      // Authenticated path: call RPC with the user's JWT so RLS + auth.uid() work.
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) {
        return res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
      }
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

    // Anonymous path.
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

async function fitImageOnPage(pdfDoc, image, pageSizeKey) {
  const sizing = PAGE_SIZES[pageSizeKey] || null;
  if (!sizing) {
    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    return;
  }
  const [pw, ph] = sizing;
  const page = pdfDoc.addPage([pw, ph]);
  const scale = Math.min(pw / image.width, ph / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  page.drawImage(image, {
    x: (pw - w) / 2,
    y: (ph - h) / 2,
    width: w,
    height: h,
  });
}

// --- Routes ---
app.post("/merge", limiter, attachReqId, upload.array("files", MAX_FILES), usageGate, async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length < 2) {
      return res.status(400).json({ error: "Please upload at least 2 PDF files." });
    }
    if (totalSize(files) > MAX_TOTAL_BYTES) {
      return res.status(413).json({ error: "Total upload size exceeds the limit." });
    }
    for (const file of files) {
      if (file.mimetype !== "application/pdf") {
        return res.status(400).json({ error: "Only PDF files are accepted for merging." });
      }
    }

    const mergedPdf = await PDFDocument.create();
    for (const file of files) {
      const sourcePdf = await PDFDocument.load(file.buffer);
      const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
      for (const page of pages) mergedPdf.addPage(page);
    }
    const mergedBytes = await mergedPdf.save();

    const filename = sanitizeFilename(req.query.name, "merged.pdf");
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": mergedBytes.length,
    });
    res.send(Buffer.from(mergedBytes));
  } catch (err) {
    logError(req.id, "merge", err);
    res.status(500).json({ error: "Failed to merge PDFs. Make sure all files are valid." });
  }
});

app.post("/convert", limiter, attachReqId, upload.array("files", MAX_FILES), usageGate, async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: "Please upload at least 1 image." });
    }
    if (totalSize(files) > MAX_TOTAL_BYTES) {
      return res.status(413).json({ error: "Total upload size exceeds the limit." });
    }
    for (const file of files) {
      if (file.mimetype !== "image/png" && file.mimetype !== "image/jpeg") {
        return res.status(400).json({ error: "Only PNG or JPEG images are accepted for conversion." });
      }
    }

    const pageSize = (req.query.pageSize || "fit").toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(PAGE_SIZES, pageSize)) {
      return res.status(400).json({ error: "Invalid pageSize. Use fit, a4, or letter." });
    }

    const pdfDoc = await PDFDocument.create();
    for (const file of files) {
      const image =
        file.mimetype === "image/png"
          ? await pdfDoc.embedPng(file.buffer)
          : await pdfDoc.embedJpg(file.buffer);
      await fitImageOnPage(pdfDoc, image, pageSize);
    }
    const pdfBytes = await pdfDoc.save();

    const filename = sanitizeFilename(req.query.name, "converted.pdf");
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": pdfBytes.length,
    });
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    logError(req.id, "convert", err);
    res.status(500).json({ error: "Failed to convert images. Make sure all files are valid PNG or JPEG." });
  }
});

// Multer / generic error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: "Unexpected error." });
});

let server;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`PDF Toolbox running at http://localhost:${PORT}`);
  });

  const shutdown = (signal) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    if (!server) return process.exit(0);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = { app };
