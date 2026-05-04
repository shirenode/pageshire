/**
 * reqId.js — Request-ID middleware.
 *
 * Generates a unique UUID (v4) for every incoming request and attaches it
 * to `req.id`. This ID is used throughout the logging utilities so that
 * all log lines related to a single request can be correlated.
 */
"use strict";

const crypto = require("crypto");

function attachReqId(req, _res, next) {
  req.id = crypto.randomUUID();
  next();
}

module.exports = attachReqId;
