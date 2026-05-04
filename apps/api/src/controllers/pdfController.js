/**
 * pdfController.js — Request handlers for the three core PDF operations.
 *
 * Each handler:
 *  1. Validates the uploaded files (count, total size).
 *  2. Delegates the heavy PDF work to pdfService.
 *  3. Streams the resulting PDF bytes back to the client as a download.
 *  4. Fires a non-blocking log_operation call via supabaseService so the
 *     operation appears in the user's history.
 *
 * Endpoints:
 *  - merge(req, res)   → POST /merge   – Combine 2+ PDFs into one.
 *  - convert(req, res) → POST /convert – Turn PNG/JPEG images into a PDF.
 *  - edit(req, res)    → POST /edit    – Reorder/rotate/delete pages,
 *                                        add watermark or page numbers.
 */
"use strict";

const { mergePdfs, imagesToPdf, editPdf } = require("../services/pdfService");
const { logOp } = require("../services/supabaseService");
const { logError } = require("../utils/logger");
const { sanitizeFilename, totalSize } = require("../utils/files");
const { MAX_TOTAL_BYTES, MAX_PAGES_PER_REQUEST, MAX_FILE_BYTES } = require("../config");

/**
 * Helper — send a Buffer of PDF bytes as a downloadable attachment.
 * Sets Content-Type, Content-Disposition (attachment), and Content-Length headers.
 */
function sendPdf(res, bytes, filename) {
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": bytes.length,
  });
  res.send(bytes);
}

/**
 * POST /merge — Merge two or more uploaded PDF files into a single PDF.
 *
 * Query params:
 *  - compress (boolean) – If "true", enable object-stream compression.
 *  - name     (string)  – Custom output filename.
 */
async function merge(req, res) {
  try {
    const files = req.files || [];

    // Need at least 2 PDFs to merge.
    if (files.length < 2) {
      return res.status(400).json({ error: "Please upload at least 2 PDF files." });
    }
    // Reject if combined file size exceeds the total limit.
    if (totalSize(files) > MAX_TOTAL_BYTES) {
      return res.status(413).json({ error: "Total upload size exceeds the limit." });
    }

    const compress = String(req.query.compress || "").toLowerCase() === "true";
    const { bytes, pageCount } = await mergePdfs(files, { compress });
    const filename = sanitizeFilename(req.query.name, "merged.pdf");
    sendPdf(res, bytes, filename);

    // Fire-and-forget: log the operation for the user's history dashboard.
    logOp(req, "merge", {
      fileCount: files.length,
      pageCount,
      bytesIn: totalSize(files),
      bytesOut: bytes.length,
    });
  } catch (err) {
    // If the service threw with a specific HTTP status, forward it.
    if (err.status) return res.status(err.status).json({ error: err.message });
    logError(req.id, "merge", err);
    res.status(500).json({ error: "Failed to merge PDFs. Make sure all files are valid." });
  }
}

/**
 * POST /convert — Convert uploaded PNG or JPEG images into a single PDF.
 *
 * Query params:
 *  - pageSize (string) – "fit" (default), "a4", or "letter".
 *  - name     (string) – Custom output filename.
 */
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

/**
 * POST /edit — Apply edits to a single uploaded PDF.
 *
 * The client sends a JSON string in the multipart field "ops" describing
 * the desired transformations:
 *  - ops.order       (number[])  – New page order (0-based indices).
 *  - ops.rotate      (object)    – Map of page-index → rotation angle (0/90/180/270).
 *  - ops.watermark   (object)    – { text, opacity?, fontSize? }
 *  - ops.pageNumbers (boolean)   – Whether to stamp "1 / N" on each page.
 *  - ops.compress    (boolean)   – Use object-stream compression.
 *  - ops.name        (string)    – Fallback output filename.
 *
 * Query params:
 *  - name (string) – Custom output filename (overrides ops.name).
 */
async function edit(req, res) {
  try {
    const files = req.files || [];

    // Edit mode accepts exactly one PDF.
    if (files.length !== 1) {
      return res.status(400).json({ error: "Please upload exactly one PDF." });
    }
    const file = files[0];
    if (file.size > MAX_FILE_BYTES) {
      return res.status(413).json({ error: "File exceeds the size limit." });
    }

    // Parse the JSON operations payload from the multipart "ops" field.
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
