const express = require("express");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { PDFDocument } = require("pdf-lib");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES) || 50 * 1024 * 1024; // 50 MB / file
const MAX_TOTAL_BYTES = Number(process.env.MAX_TOTAL_BYTES) || 200 * 1024 * 1024; // 200 MB / request
const MAX_FILES = Number(process.env.MAX_FILES) || 50;

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
        "script-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:"],
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
app.post("/merge", limiter, attachReqId, upload.array("files", MAX_FILES), async (req, res) => {
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

app.post("/convert", limiter, attachReqId, upload.array("files", MAX_FILES), async (req, res) => {
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
