"use strict";

const multer = require("multer");

function errorHandler(err, _req, res, _next) {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: "Unexpected error." });
}

module.exports = errorHandler;
