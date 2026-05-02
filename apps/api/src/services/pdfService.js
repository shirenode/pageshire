"use strict";

const { PDFDocument, StandardFonts, degrees, rgb } = require("pdf-lib");
const {
  PAGE_SIZES,
  MAX_PAGES_PER_FILE,
  MAX_PAGES_PER_REQUEST,
} = require("../config");
const { sniffMime } = require("../utils/sniffMime");

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
  page.drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
}

async function mergePdfs(files, { compress = false } = {}) {
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
    let source;
    try {
      source = await PDFDocument.load(file.buffer, { ignoreEncryption: false });
    } catch {
      const err = new Error(`Could not parse "${file.originalname}". It may be encrypted or corrupted.`);
      err.status = 400;
      throw err;
    }
    const pageCount = source.getPageCount();
    if (pageCount > MAX_PAGES_PER_FILE) {
      const err = new Error(`"${file.originalname}" has ${pageCount} pages (max ${MAX_PAGES_PER_FILE} per file).`);
      err.status = 413;
      throw err;
    }
    totalPages += pageCount;
    if (totalPages > MAX_PAGES_PER_REQUEST) {
      const err = new Error(`Combined page count exceeds the limit of ${MAX_PAGES_PER_REQUEST}.`);
      err.status = 413;
      throw err;
    }
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  const bytes = await merged.save({ useObjectStreams: compress });
  return { bytes: Buffer.from(bytes), pageCount: totalPages };
}

async function imagesToPdf(files, { pageSize = "fit" } = {}) {
  if (!Object.prototype.hasOwnProperty.call(PAGE_SIZES, pageSize)) {
    const err = new Error("Invalid pageSize. Use fit, a4, or letter.");
    err.status = 400;
    throw err;
  }
  for (const file of files) {
    const actual = sniffMime(file.buffer);
    if (actual !== "image/png" && actual !== "image/jpeg") {
      const err = new Error(`File "${file.originalname}" is not a valid PNG or JPEG image.`);
      err.status = 400;
      throw err;
    }
    file.mimetype = actual;
  }
  const pdf = await PDFDocument.create();
  for (const file of files) {
    const image = file.mimetype === "image/png"
      ? await pdf.embedPng(file.buffer)
      : await pdf.embedJpg(file.buffer);
    await fitImageOnPage(pdf, image, pageSize);
  }
  const bytes = await pdf.save();
  return { bytes: Buffer.from(bytes), pageCount: pdf.getPageCount() };
}

async function editPdf(file, ops = {}) {
  if (sniffMime(file.buffer) !== "application/pdf") {
    const err = new Error(`"${file.originalname}" is not a valid PDF.`);
    err.status = 400;
    throw err;
  }
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
    order = Array.from({ length: sourcePageCount }, (_, i) => i);
  }
  if (order.length === 0) {
    const err = new Error("Cannot delete every page.");
    err.status = 400;
    throw err;
  }

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

  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, order);
  copied.forEach((page, outIdx) => {
    const sourceIdx = order[outIdx];
    const angle = rotate[sourceIdx] || 0;
    if (angle) {
      const current = page.getRotation().angle || 0;
      page.setRotation(degrees((current + angle) % 360));
    }
    out.addPage(page);
  });

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

  const compress = ops.compress === true;
  const bytes = await out.save({ useObjectStreams: compress });
  return { bytes: Buffer.from(bytes), pageCount: out.getPageCount() };
}

module.exports = { mergePdfs, imagesToPdf, editPdf };
