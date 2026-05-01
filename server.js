require("dotenv").config();
const express = require("express");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { PDFDocument, StandardFonts, degrees, rgb } = require("pdf-lib");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES) || 50 * 1024 * 1024; // 50 MB / file
const MAX_TOTAL_BYTES = Number(process.env.MAX_TOTAL_BYTES) || 200 * 1024 * 1024; // 200 MB / request
const MAX_FILES = Number(process.env.MAX_FILES) || 50;
const FREE_MERGE_LIMIT = Number(process.env.FREE_MERGE_LIMIT) || 2;
const USAGE_WINDOW_HOURS = Number(process.env.USAGE_WINDOW_HOURS) || 24;
const MAX_PAGES_PER_FILE = Number(process.env.MAX_PAGES_PER_FILE) || 2000;
const MAX_PAGES_PER_REQUEST = Number(process.env.MAX_PAGES_PER_REQUEST) || 5000;
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);

// Detect actual file type from magic bytes — never trust client-supplied mimetype.
function sniffMime(buf) {
  if (!buf || buf.length < 4) return null;
  // PDF: "%PDF-"
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d) {
    return "application/pdf";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

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
        "worker-src": ["'self'", "blob:", "https://cdn.jsdelivr.net"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'", ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : []), "https://*.supabase.co", "https://cdn.jsdelivr.net"],
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

// Fire-and-forget operation log (best effort; failures are logged but don't break the request).
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

async function usageGate(req, res, next) {
  try {
    const userClient = supabaseForRequest(req);
    if (userClient) {
      // Authenticated path: call RPC with the user's JWT so RLS + auth.uid() work.
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
      const actual = sniffMime(file.buffer);
      if (actual !== "application/pdf") {
        return res.status(400).json({ error: `File "${file.originalname}" is not a valid PDF.` });
      }
    }

    const mergedPdf = await PDFDocument.create();
    let totalPages = 0;
    for (const file of files) {
      let sourcePdf;
      try {
        sourcePdf = await PDFDocument.load(file.buffer, { ignoreEncryption: false });
      } catch (e) {
        return res.status(400).json({ error: `Could not parse "${file.originalname}". It may be encrypted or corrupted.` });
      }
      const pageCount = sourcePdf.getPageCount();
      if (pageCount > MAX_PAGES_PER_FILE) {
        return res.status(413).json({ error: `"${file.originalname}" has ${pageCount} pages (max ${MAX_PAGES_PER_FILE} per file).` });
      }
      totalPages += pageCount;
      if (totalPages > MAX_PAGES_PER_REQUEST) {
        return res.status(413).json({ error: `Combined page count exceeds the limit of ${MAX_PAGES_PER_REQUEST}.` });
      }
      const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
      for (const page of pages) mergedPdf.addPage(page);
    }
    const compress = String(req.query.compress || "").toLowerCase() === "true";
    const mergedBytes = await mergedPdf.save({ useObjectStreams: compress });

    const filename = sanitizeFilename(req.query.name, "merged.pdf");
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": mergedBytes.length,
    });
    res.send(Buffer.from(mergedBytes));
    logOp(req, "merge", {
      fileCount: files.length,
      pageCount: totalPages,
      bytesIn: totalSize(files),
      bytesOut: mergedBytes.length,
    });
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
    if (files.length > MAX_PAGES_PER_REQUEST) {
      return res.status(413).json({ error: `Too many images (max ${MAX_PAGES_PER_REQUEST}).` });
    }
    for (const file of files) {
      const actual = sniffMime(file.buffer);
      if (actual !== "image/png" && actual !== "image/jpeg") {
        return res.status(400).json({ error: `File "${file.originalname}" is not a valid PNG or JPEG image.` });
      }
      // Re-tag with sniffed type so downstream embed picks the right decoder.
      file.mimetype = actual;
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
    logOp(req, "convert", {
      fileCount: files.length,
      pageCount: pdfDoc.getPageCount(),
      bytesIn: totalSize(files),
      bytesOut: pdfBytes.length,
    });
  } catch (err) {
    logError(req.id, "convert", err);
    res.status(500).json({ error: "Failed to convert images. Make sure all files are valid PNG or JPEG." });
  }
});

// --- /edit: page-level operations on a single PDF ---
// Body: multipart, fields:
//   files: 1 PDF
//   ops:   JSON string {
//            order?: number[]            // 0-based page indices in desired order; pages not listed are dropped
//            rotate?: { [pageIndex]: 90|180|270 }   // applied AFTER reorder, indices refer to pre-reorder pages
//            watermark?: { text: string, opacity?: number, fontSize?: number }
//            pageNumbers?: boolean
//            compress?: boolean
//          }
app.post("/edit", limiter, attachReqId, upload.array("files", 1), usageGate, async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length !== 1) {
      return res.status(400).json({ error: "Please upload exactly one PDF." });
    }
    const file = files[0];
    if (sniffMime(file.buffer) !== "application/pdf") {
      return res.status(400).json({ error: `"${file.originalname}" is not a valid PDF.` });
    }
    if (file.size > MAX_FILE_BYTES) {
      return res.status(413).json({ error: "File exceeds the size limit." });
    }

    let ops = {};
    if (req.body?.ops) {
      try { ops = JSON.parse(req.body.ops); } catch {
        return res.status(400).json({ error: "Invalid ops JSON." });
      }
    }

    let source;
    try {
      source = await PDFDocument.load(file.buffer, { ignoreEncryption: false });
    } catch {
      return res.status(400).json({ error: "Could not parse the PDF. It may be encrypted or corrupted." });
    }
    const sourcePageCount = source.getPageCount();
    if (sourcePageCount > MAX_PAGES_PER_FILE) {
      return res.status(413).json({ error: `Too many pages (max ${MAX_PAGES_PER_FILE}).` });
    }

    // Validate order: array of unique 0-based ints, each < sourcePageCount.
    let order = ops.order;
    if (Array.isArray(order)) {
      const seen = new Set();
      for (const idx of order) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= sourcePageCount || seen.has(idx)) {
          return res.status(400).json({ error: "Invalid 'order': must be unique 0-based page indices." });
        }
        seen.add(idx);
      }
    } else {
      order = Array.from({ length: sourcePageCount }, (_, i) => i);
    }
    if (order.length === 0) {
      return res.status(400).json({ error: "Cannot delete every page." });
    }

    // Validate rotate map.
    const rotate = ops.rotate && typeof ops.rotate === "object" ? ops.rotate : {};
    for (const [k, v] of Object.entries(rotate)) {
      const idx = Number(k);
      if (!Number.isInteger(idx) || idx < 0 || idx >= sourcePageCount) {
        return res.status(400).json({ error: `Invalid rotate index: ${k}` });
      }
      if (![0, 90, 180, 270].includes(v)) {
        return res.status(400).json({ error: `Invalid rotate angle for page ${k}: must be 0/90/180/270.` });
      }
    }

    const out = await PDFDocument.create();
    const copied = await out.copyPages(source, order);
    copied.forEach((page, outIdx) => {
      const sourceIdx = order[outIdx];
      const angle = rotate[sourceIdx] || 0;
      if (angle) {
        const current = page.getRotation().angle || 0;
        page.setRotation(degrees((current + angle) % 360));
      }
      out.addPage(page);
    });

    // Watermark.
    if (ops.watermark && typeof ops.watermark.text === "string" && ops.watermark.text.trim()) {
      const text = ops.watermark.text.slice(0, 100);
      const opacity = Math.min(1, Math.max(0.05, Number(ops.watermark.opacity) || 0.2));
      const fontSize = Math.min(120, Math.max(12, Number(ops.watermark.fontSize) || 60));
      const font = await out.embedFont(StandardFonts.HelveticaBold);
      const pages = out.getPages();
      for (const p of pages) {
        const { width, height } = p.getSize();
        const tw = font.widthOfTextAtSize(text, fontSize);
        p.drawText(text, {
          x: (width - tw) / 2,
          y: height / 2,
          size: fontSize,
          font,
          color: rgb(0.5, 0.5, 0.5),
          opacity,
          rotate: degrees(45),
        });
      }
    }

    // Page numbers.
    if (ops.pageNumbers === true) {
      const font = await out.embedFont(StandardFonts.Helvetica);
      const pages = out.getPages();
      pages.forEach((p, i) => {
        const { width } = p.getSize();
        const label = `${i + 1} / ${pages.length}`;
        const size = 10;
        const tw = font.widthOfTextAtSize(label, size);
        p.drawText(label, {
          x: (width - tw) / 2,
          y: 18,
          size,
          font,
          color: rgb(0.3, 0.3, 0.3),
        });
      });
    }

    const compress = ops.compress === true;
    const outBytes = await out.save({ useObjectStreams: compress });
    const filename = sanitizeFilename(req.query.name || ops.name, "edited.pdf");
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": outBytes.length,
    });
    res.send(Buffer.from(outBytes));
    logOp(req, "edit", {
      fileCount: 1,
      pageCount: out.getPageCount(),
      bytesIn: file.size,
      bytesOut: outBytes.length,
    });
  } catch (err) {
    logError(req.id, "edit", err);
    res.status(500).json({ error: "Failed to edit the PDF." });
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
    console.log(`Pageshire running at http://localhost:${PORT}`);
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
