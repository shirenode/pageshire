/**
 * server.test.js — Integration tests for the Pageshire API.
 *
 * Uses Node's built-in test runner (`node --test`) and supertest to make
 * HTTP requests against the Express app without starting a real server.
 *
 * Tests cover:
 *  - Health-check endpoint.
 *  - Merge: minimum file count, successful merge, magic-byte rejection.
 *  - Convert: empty upload, PNG → PDF, non-image rejection, invalid pageSize.
 *  - Edit: page reorder, out-of-range index, invalid rotation, watermark + page numbers.
 */
const assert = require("assert");
const { test } = require("node:test");
const request = require("supertest");
const { PDFDocument } = require("pdf-lib");

// Raise the free-merge limit for tests so the usage gate doesn't block requests.
process.env.FREE_MERGE_LIMIT = process.env.FREE_MERGE_LIMIT || "10000";
const { app } = require("../src/server");

/**
 * Helper — create a minimal valid PDF buffer with the given number of pages.
 * Each page is 200×200 pt.
 */
async function makePdfBuffer(pageCount = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

/**
 * Helper — create a minimal valid 1×1 transparent PNG buffer.
 * Used for testing the /convert endpoint.
 */
async function makePngBuffer() {
  const doc = await PDFDocument.create();
  doc.addPage([10, 10]);
  // Hardcoded base64 of a 1×1 transparent PNG.
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64"
  );
}

// ---- Health check ----
test("GET /healthz returns ok", async () => {
  const res = await request(app).get("/healthz");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, "ok");
});

// ---- Merge ----
test("POST /merge requires at least 2 files", async () => {
  const buf = await makePdfBuffer();
  const res = await request(app)
    .post("/merge")
    .attach("files", buf, "a.pdf");
  assert.strictEqual(res.status, 400);
});

test("POST /merge merges 2 PDFs", async () => {
  const a = await makePdfBuffer(1);
  const b = await makePdfBuffer(2);
  const res = await request(app)
    .post("/merge")
    .attach("files", a, "a.pdf")
    .attach("files", b, "b.pdf");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers["content-type"], "application/pdf");
  // Verify the merged PDF has the expected page count (1 + 2 = 3).
  const merged = await PDFDocument.load(res.body);
  assert.strictEqual(merged.getPageCount(), 3);
});

// ---- Convert ----
test("POST /convert rejects empty uploads", async () => {
  const res = await request(app).post("/convert");
  assert.strictEqual(res.status, 400);
});

test("POST /convert turns PNG into PDF", async () => {
  const png = await makePngBuffer();
  const res = await request(app)
    .post("/convert")
    .attach("files", png, { filename: "img.png", contentType: "image/png" });
  assert.strictEqual(res.status, 200);
  const pdf = await PDFDocument.load(res.body);
  assert.strictEqual(pdf.getPageCount(), 1);
});

test("POST /convert rejects non-image files", async () => {
  // A valid PDF is not an image — /convert should reject it.
  const pdf = await makePdfBuffer();
  const res = await request(app)
    .post("/convert")
    .attach("files", pdf, "a.pdf");
  assert.strictEqual(res.status, 400);
});

test("POST /convert validates pageSize", async () => {
  const png = await makePngBuffer();
  const res = await request(app)
    .post("/convert?pageSize=garbage")
    .attach("files", png, { filename: "img.png", contentType: "image/png" });
  assert.strictEqual(res.status, 400);
});

// ---- Magic-byte security checks ----
test("POST /merge rejects file with PDF extension but non-PDF content (magic-byte check)", async () => {
  // Buffer claiming to be a PDF but actually plain text — must be rejected
  // even though mimetype/extension say PDF.
  const fakePdf = Buffer.from("Not a real PDF, just text masquerading as one");
  const realPdf = await makePdfBuffer(1);
  const res = await request(app)
    .post("/merge")
    .attach("files", fakePdf, { filename: "fake.pdf", contentType: "application/pdf" })
    .attach("files", realPdf, { filename: "real.pdf", contentType: "application/pdf" });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /not a valid PDF/);
});

test("POST /convert rejects file with image extension but non-image content (magic-byte check)", async () => {
  const fakePng = Buffer.from("This is not a PNG");
  const res = await request(app)
    .post("/convert")
    .attach("files", fakePng, { filename: "fake.png", contentType: "image/png" });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /not a valid PNG or JPEG/);
});

// ---- Edit ----
test("POST /edit reorders pages via ops.order", async () => {
  const buf = await makePdfBuffer(3);
  // Reverse the page order: [2, 1, 0].
  const ops = JSON.stringify({ order: [2, 1, 0] });
  const res = await request(app)
    .post("/edit")
    .field("ops", ops)
    .attach("files", buf, "in.pdf");
  assert.strictEqual(res.status, 200);
  const out = await PDFDocument.load(res.body);
  assert.strictEqual(out.getPageCount(), 3);
});

test("POST /edit rejects out-of-range order index", async () => {
  const buf = await makePdfBuffer(2);
  // Index 5 is out of range for a 2-page PDF.
  const ops = JSON.stringify({ order: [0, 5] });
  const res = await request(app)
    .post("/edit")
    .field("ops", ops)
    .attach("files", buf, "in.pdf");
  assert.strictEqual(res.status, 400);
});

test("POST /edit rejects invalid rotate angle", async () => {
  const buf = await makePdfBuffer(1);
  // 45° is not a valid rotation angle (only 0/90/180/270 are accepted).
  const ops = JSON.stringify({ order: [0], rotate: { 0: 45 } });
  const res = await request(app)
    .post("/edit")
    .field("ops", ops)
    .attach("files", buf, "in.pdf");
  assert.strictEqual(res.status, 400);
});

test("POST /edit applies watermark and page numbers", async () => {
  const buf = await makePdfBuffer(2);
  const ops = JSON.stringify({
    order: [0, 1],
    watermark: { text: "DRAFT" },
    pageNumbers: true,
    compress: true,
  });
  const res = await request(app)
    .post("/edit")
    .field("ops", ops)
    .attach("files", buf, "in.pdf");
  assert.strictEqual(res.status, 200);
  const out = await PDFDocument.load(res.body);
  assert.strictEqual(out.getPageCount(), 2);
});
