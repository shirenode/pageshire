"use strict";

const { mergePdfs, imagesToPdf, editPdf } = require("../services/pdfService");
const { logOp } = require("../services/supabaseService");
const { logError } = require("../utils/logger");
const { sanitizeFilename, totalSize } = require("../utils/files");
const { MAX_TOTAL_BYTES, MAX_PAGES_PER_REQUEST, MAX_FILE_BYTES } = require("../config");

function sendPdf(res, bytes, filename) {
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": bytes.length,
  });
  res.send(bytes);
}

async function merge(req, res) {
  try {
    const files = req.files || [];
    if (files.length < 2) {
      return res.status(400).json({ error: "Please upload at least 2 PDF files." });
    }
    if (totalSize(files) > MAX_TOTAL_BYTES) {
      return res.status(413).json({ error: "Total upload size exceeds the limit." });
    }
    const compress = String(req.query.compress || "").toLowerCase() === "true";
    const { bytes, pageCount } = await mergePdfs(files, { compress });
    const filename = sanitizeFilename(req.query.name, "merged.pdf");
    sendPdf(res, bytes, filename);
    logOp(req, "merge", {
      fileCount: files.length,
      pageCount,
      bytesIn: totalSize(files),
      bytesOut: bytes.length,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logError(req.id, "merge", err);
    res.status(500).json({ error: "Failed to merge PDFs. Make sure all files are valid." });
  }
}

async function convert(req, res) {
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
    const pageSize = (req.query.pageSize || "fit").toLowerCase();
    const { bytes, pageCount } = await imagesToPdf(files, { pageSize });
    const filename = sanitizeFilename(req.query.name, "converted.pdf");
    sendPdf(res, bytes, filename);
    logOp(req, "convert", {
      fileCount: files.length,
      pageCount,
      bytesIn: totalSize(files),
      bytesOut: bytes.length,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logError(req.id, "convert", err);
    res.status(500).json({ error: "Failed to convert images. Make sure all files are valid PNG or JPEG." });
  }
}

async function edit(req, res) {
  try {
    const files = req.files || [];
    if (files.length !== 1) {
      return res.status(400).json({ error: "Please upload exactly one PDF." });
    }
    const file = files[0];
    if (file.size > MAX_FILE_BYTES) {
      return res.status(413).json({ error: "File exceeds the size limit." });
    }
    let ops = {};
    if (req.body?.ops) {
      try { ops = JSON.parse(req.body.ops); } catch {
        return res.status(400).json({ error: "Invalid ops JSON." });
      }
    }
    const { bytes, pageCount } = await editPdf(file, ops);
    const filename = sanitizeFilename(req.query.name || ops.name, "edited.pdf");
    sendPdf(res, bytes, filename);
    logOp(req, "edit", {
      fileCount: 1,
      pageCount,
      bytesIn: file.size,
      bytesOut: bytes.length,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logError(req.id, "edit", err);
    res.status(500).json({ error: "Failed to edit the PDF." });
  }
}

module.exports = { merge, convert, edit };
