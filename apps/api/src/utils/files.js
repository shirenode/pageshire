/**
 * files.js — File-related utility helpers.
 *
 * - sanitizeFilename(name, fallback): Cleans a user-provided filename for
 *   safe use in a Content-Disposition header. Strips special characters,
 *   enforces a max length, and ensures it ends with ".pdf".
 *
 * - totalSize(files): Sums up the byte sizes of an array of Multer file
 *   objects. Used by controllers to enforce the MAX_TOTAL_BYTES limit.
 */
"use strict";

/**
 * Sanitise a user-supplied filename.
 * Returns `fallback` if the input is missing or entirely invalid.
 */
function sanitizeFilename(name, fallback) {
  if (typeof name !== "string") return fallback;
  const trimmed = name.trim().slice(0, 80);
  // Strip anything that isn't alphanumeric, dot, hyphen, or underscore.
  const cleaned = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  // Ensure the filename always ends with ".pdf".
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

/**
 * Sum the `.size` of every Multer file object in the array.
 */
function totalSize(files) {
  return files.reduce((sum, f) => sum + f.size, 0);
}

module.exports = { sanitizeFilename, totalSize };
