/**
 * pdfService.js — Core PDF manipulation logic (powered by pdf-lib).
 *
 * Exposes three pure-ish async functions that accept uploaded file buffers
 * and return { bytes: Buffer, pageCount: number }:
 *
 *  - mergePdfs(files, opts)     – Combine multiple PDFs into one.
 *  - imagesToPdf(files, opts)   – Embed PNG/JPEG images into a new PDF.
 *  - editPdf(file, ops)         – Reorder, rotate, delete pages; add
 *                                  watermark text and/or page numbers.
 *
 * All functions perform magic-byte validation (via sniffMime) so they
 * never trust the client-supplied MIME type.
 */
"use strict";

const { PDFDocument, StandardFonts, degrees, rgb } = require("pdf-lib");
const {
  PAGE_SIZES,
  MAX_PAGES_PER_FILE,
  MAX_PAGES_PER_REQUEST,
} = require("../config");
const { sniffMime } = require("../utils/sniffMime");

/**
 * Embed a single image onto a new page in `pdfDoc`.
 *
 * If `pageSizeKey` is "fit", the page matches the image's native dimensions.
 * Otherwise the image is scaled to fit the named page size (A4 / Letter)
 * while preserving its aspect ratio, and centred on the page.
 */
async function fitImageOnPage(pdfDoc, image, pageSizeKey) {
  const sizing = PAGE_SIZES[pageSizeKey] || null;

  if (!sizing) {
    // "fit" mode — page dimensions = image dimensions.
    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    return;
  }

  // Fixed page size — scale image to fit and centre it.
  const [pw, ph] = sizing;
  const page = pdfDoc.addPage([pw, ph]);
  const scale = Math.min(pw / image.width, ph / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  page.drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
}

/**
 * Merge multiple PDF files into a single PDF document.
 *
 * Steps:
 *  1. Validate each file's magic bytes to ensure it is actually a PDF.
 *  2. Load each source PDF and enforce per-file + total page-count limits.
 *  3. Copy every page from each source into a new combined document.
 *  4. Save and return the merged bytes.
 *
 * @param {Array} files   - Multer file objects with `.buffer` and `.originalname`.
 * @param {Object} [opts] - { compress: boolean }
 * @returns {{ bytes: Buffer, pageCount: number }}
 */
async function mergePdfs(files, { compress = false } = {}) {
  // Validate every file is actually a PDF (magic-byte check).
  for (const file of files) {
    if (sniffMime(file.buffer) !== "application/pdf") {
      const err = new Error(`File "${file.originalname}" is not a valid PDF.`);
      err.status = 400;
      throw err;
    }
  }

  const merged = await PDFDocument.create();
  let totalPages = 0;

  for (const file of files) {
    // Attempt to parse the PDF. Encrypted/corrupted files will throw.
    let source;
    try {
      source = await PDFDocument.load(file.buffer, { ignoreEncryption: false });
    } catch {
      const err = new Error(`Could not parse "${file.originalname}". It may be encrypted or corrupted.`);
      err.status = 400;
      throw err;
    }

    // Per-file page-count guard.
    const pageCount = source.getPageCount();
    if (pageCount > MAX_PAGES_PER_FILE) {
      const err = new Error(`"${file.originalname}" has ${pageCount} pages (max ${MAX_PAGES_PER_FILE} per file).`);
      err.status = 413;
      throw err;
    }

    // Cumulative page-count guard.
    totalPages += pageCount;
    if (totalPages > MAX_PAGES_PER_REQUEST) {
      const err = new Error(`Combined page count exceeds the limit of ${MAX_PAGES_PER_REQUEST}.`);
      err.status = 413;
      throw err;
    }

    // Copy all pages from this source into the merged document.
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }

  // Serialise the merged PDF. Object-stream compression reduces file size.
  const bytes = await merged.save({ useObjectStreams: compress });
  return { bytes: Buffer.from(bytes), pageCount: totalPages };
}

/**
 * Convert one or more PNG/JPEG images into a single PDF.
 *
 * Each image becomes one page. The page size is determined by `pageSize`:
 *  - "fit"    → page matches image dimensions.
 *  - "a4"     → standard A4 (595 × 842 pt), image scaled + centred.
 *  - "letter" → US Letter (612 × 792 pt), image scaled + centred.
 *
 * @param {Array} files   - Multer file objects (image buffers).
 * @param {Object} [opts] - { pageSize: "fit" | "a4" | "letter" }
 * @returns {{ bytes: Buffer, pageCount: number }}
 */
async function imagesToPdf(files, { pageSize = "fit" } = {}) {
  // Validate the requested page size.
  if (!Object.prototype.hasOwnProperty.call(PAGE_SIZES, pageSize)) {
    const err = new Error("Invalid pageSize. Use fit, a4, or letter.");
    err.status = 400;
    throw err;
  }

  // Magic-byte check: ensure every file is genuinely a PNG or JPEG.
  for (const file of files) {
    const actual = sniffMime(file.buffer);
    if (actual !== "image/png" && actual !== "image/jpeg") {
      const err = new Error(`File "${file.originalname}" is not a valid PNG or JPEG image.`);
      err.status = 400;
      throw err;
    }
    // Override the client-declared MIME with the detected one.
    file.mimetype = actual;
  }

  const pdf = await PDFDocument.create();

  // Embed each image and place it on a new page.
  for (const file of files) {
    const image = file.mimetype === "image/png"
      ? await pdf.embedPng(file.buffer)
      : await pdf.embedJpg(file.buffer);
    await fitImageOnPage(pdf, image, pageSize);
  }

  const bytes = await pdf.save();
  return { bytes: Buffer.from(bytes), pageCount: pdf.getPageCount() };
}

/**
 * Edit a single PDF: reorder, rotate, delete pages, add watermark /
 * page numbers, and optionally compress the output.
 *
 * @param {Object} file - Multer file object with `.buffer`.
 * @param {Object} ops  - Edit operations (see pdfController for schema).
 * @returns {{ bytes: Buffer, pageCount: number }}
 */
async function editPdf(file, ops = {}) {
  // Validate the file is actually a PDF.
  if (sniffMime(file.buffer) !== "application/pdf") {
    const err = new Error(`"${file.originalname}" is not a valid PDF.`);
    err.status = 400;
    throw err;
  }

  // Load the source PDF.
  let source;
  try {
    source = await PDFDocument.load(file.buffer, { ignoreEncryption: false });
  } catch {
    const err = new Error("Could not parse the PDF. It may be encrypted or corrupted.");
    err.status = 400;
    throw err;
  }

  const sourcePageCount = source.getPageCount();
  if (sourcePageCount > MAX_PAGES_PER_FILE) {
    const err = new Error(`Too many pages (max ${MAX_PAGES_PER_FILE}).`);
    err.status = 413;
    throw err;
  }

  // ---- Page order validation ----
  // ops.order is an array of 0-based page indices defining the new page sequence.
  // Missing indices = deleted pages. Duplicates are not allowed.
  let order = ops.order;
  if (Array.isArray(order)) {
    const seen = new Set();
    for (const idx of order) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= sourcePageCount || seen.has(idx)) {
        const err = new Error("Invalid 'order': must be unique 0-based page indices.");
        err.status = 400;
        throw err;
      }
      seen.add(idx);
    }
  } else {
    // Default: keep all pages in their original order.
    order = Array.from({ length: sourcePageCount }, (_, i) => i);
  }
  if (order.length === 0) {
    const err = new Error("Cannot delete every page.");
    err.status = 400;
    throw err;
  }

  // ---- Rotation validation ----
  // ops.rotate is a map of { sourcePageIndex: angle } where angle ∈ {0, 90, 180, 270}.
  const rotate = ops.rotate && typeof ops.rotate === "object" ? ops.rotate : {};
  for (const [k, v] of Object.entries(rotate)) {
    const idx = Number(k);
    if (!Number.isInteger(idx) || idx < 0 || idx >= sourcePageCount) {
      const err = new Error(`Invalid rotate index: ${k}`);
      err.status = 400;
      throw err;
    }
    if (![0, 90, 180, 270].includes(v)) {
      const err = new Error(`Invalid rotate angle for page ${k}: must be 0/90/180/270.`);
      err.status = 400;
      throw err;
    }
  }

  // ---- Build the output document ----
  const out = await PDFDocument.create();
  // Copy only the pages specified by `order` from the source.
  const copied = await out.copyPages(source, order);

  copied.forEach((page, outIdx) => {
    const sourceIdx = order[outIdx];
    const angle = rotate[sourceIdx] || 0;
    if (angle) {
      // Add the requested rotation on top of any existing rotation.
      const current = page.getRotation().angle || 0;
      page.setRotation(degrees((current + angle) % 360));
    }
    out.addPage(page);
  });

  // ---- Watermark (optional) ----
  // Draws semi-transparent, rotated text at the centre of every page.
  if (ops.watermark && typeof ops.watermark.text === "string" && ops.watermark.text.trim()) {
    const text = ops.watermark.text.slice(0, 100);
    const opacity = Math.min(1, Math.max(0.05, Number(ops.watermark.opacity) || 0.2));
    const fontSize = Math.min(120, Math.max(12, Number(ops.watermark.fontSize) || 60));
    const font = await out.embedFont(StandardFonts.HelveticaBold);
    for (const p of out.getPages()) {
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

  // ---- Page numbers (optional) ----
  // Stamps "1 / N" centred at the bottom of each page.
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

  // Serialise with optional object-stream compression.
  const compress = ops.compress === true;
  const bytes = await out.save({ useObjectStreams: compress });
  return { bytes: Buffer.from(bytes), pageCount: out.getPageCount() };
}

module.exports = { mergePdfs, imagesToPdf, editPdf };
