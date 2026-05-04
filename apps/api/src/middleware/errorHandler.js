/**
 * errorHandler.js — Global Express error-handling middleware.
 *
 * Catches errors thrown (or passed via next(err)) by upstream middleware and
 * controllers. It distinguishes Multer upload errors (e.g. file too large,
 * too many files) from generic errors and returns a JSON response with an
 * appropriate HTTP status.
 *
 * Must be registered *after* all routes so Express treats it as the
 * final error handler (4-argument signature).
 */
"use strict";

const multer = require("multer");

function errorHandler(err, _req, res, _next) {
  // Multer-specific upload errors (file size exceeded, field count, etc.).
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  // Any other error thrown during request processing.
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  // Fallback for unexpected situations.
  return res.status(500).json({ error: "Unexpected error." });
}

module.exports = errorHandler;
