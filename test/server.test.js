const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { test } = require("node:test");
const request = require("supertest");
const { PDFDocument } = require("pdf-lib");
process.env.FREE_MERGE_LIMIT = process.env.FREE_MERGE_LIMIT || "10000";
const { app } = require("../server");

async function makePdfBuffer(pageCount = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

async function makePngBuffer() {
  const doc = await PDFDocument.create();
  doc.addPage([10, 10]);
  // 1x1 transparent PNG
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64"
  );
}

test("GET /healthz returns ok", async () => {
  const res = await request(app).get("/healthz");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, "ok");
});

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
  const merged = await PDFDocument.load(res.body);
  assert.strictEqual(merged.getPageCount(), 3);
});

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

test("POST /merge rejects file with PDF extension but non-PDF content (magic-byte check)", async () => {
  // Buffer claiming to be a PDF but actually plain text \u2014 must be rejected even though mimetype/extension say PDF.
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
