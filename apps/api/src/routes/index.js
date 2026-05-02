"use strict";

const express = require("express");
const { MAX_FILES } = require("../config");
const upload = require("../middleware/upload");
const attachReqId = require("../middleware/reqId");
const { limiter } = require("../middleware/security");
const usageGate = require("../middleware/usageGate");
const meta = require("../controllers/metaController");
const pdf = require("../controllers/pdfController");

const router = express.Router();

router.get("/healthz", meta.getHealth);
router.get("/config", meta.getConfig);

router.post(
  "/merge",
  limiter, attachReqId, upload.array("files", MAX_FILES), usageGate,
  pdf.merge,
);

router.post(
  "/convert",
  limiter, attachReqId, upload.array("files", MAX_FILES), usageGate,
  pdf.convert,
);

router.post(
  "/edit",
  limiter, attachReqId, upload.array("files", 1), usageGate,
  pdf.edit,
);

module.exports = router;
