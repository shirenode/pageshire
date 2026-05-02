"use strict";

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

module.exports = { sanitizeFilename, totalSize };
