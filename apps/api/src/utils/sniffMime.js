/**
 * sniffMime.js — Magic-byte file-type detection.
 *
 * Inspects the first few bytes ("magic bytes") of a file buffer to
 * determine its true MIME type, regardless of what the client says.
 * This is critical for security: a malicious client could upload a
 * dangerous file with a spoofed Content-Type header.
 *
 * Supported detections:
 *   %PDF-    → "application/pdf"
 *   \x89PNG  → "image/png"
 *   \xFF\xD8\xFF → "image/jpeg"
 *   (anything else) → null
 */
"use strict";

function sniffMime(buf) {
  if (!buf || buf.length < 4) return null;

  // PDF: starts with "%PDF-" (hex 25 50 44 46 2D).
  if (
    buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d
  ) return "application/pdf";

  // PNG: starts with the 8-byte PNG signature.
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return "image/png";

  // JPEG: starts with the SOI marker FF D8 FF.
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";

  // Unknown file type.
  return null;
}

module.exports = { sniffMime };
