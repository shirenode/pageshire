const express = require("express");
const multer = require("multer");
const { PDFDocument } = require("pdf-lib");
const path = require("path");

const app = express();
const PORT = 3000;

// Configure multer for in-memory file handling (no disk storage needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed."));
    }
  },
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, "public")));

// POST /merge – accepts multiple PDF files, returns a single merged PDF
app.post("/merge", upload.array("files", 50), async (req, res) => {
  try {
    if (!req.files || req.files.length < 2) {
      return res.status(400).json({ error: "Please upload at least 2 PDF files." });
    }

    const mergedPdf = await PDFDocument.create();

    for (const file of req.files) {
      const sourcePdf = await PDFDocument.load(file.buffer);
      const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
      for (const page of pages) {
        mergedPdf.addPage(page);
      }
    }

    const mergedBytes = await mergedPdf.save();

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="merged.pdf"',
      "Content-Length": mergedBytes.length,
    });
    res.send(Buffer.from(mergedBytes));
  } catch (err) {
    console.error("Merge error:", err.message);
    res.status(500).json({ error: "Failed to merge PDFs. Make sure all files are valid." });
  }
});

// Handle multer errors (file too large, wrong type, etc.)
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`PDF Merger running at http://localhost:${PORT}`);
});
