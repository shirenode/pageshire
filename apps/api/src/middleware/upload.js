/**
 * upload.js — Multer file-upload middleware.
 *
 * Configures Multer to:
 *  - Store uploaded files in memory (Buffer) — no temp files on disk.
 *  - Enforce a per-file size limit (MAX_FILE_BYTES, default 50 MB).
 *  - Enforce a maximum number of files per request (MAX_FILES, default 50).
 *  - Reject files whose MIME type is not in the ALLOWED_MIME set
 *    (application/pdf, image/png, image/jpeg).
 *
 * Note: this checks the *client-declared* MIME type only. The pdfService
 * layer does a secondary magic-byte check (sniffMime) for real validation.
 */
"use strict";

const multer = require("multer");
const { MAX_FILE_BYTES, MAX_FILES, ALLOWED_MIME } = require("../config");

const upload = multer({
  // Keep uploaded file data in memory as Buffers (no disk I/O).
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: MAX_FILES,
  },
  // First-pass MIME filter based on the Content-Type the client sends.
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

module.exports = upload;
