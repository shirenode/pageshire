"use strict";

function logError(reqId, label, err) {
  console.error(`[${reqId}] ${label}:`, err && err.stack ? err.stack : err);
}

function logInfo(msg) {
  console.log(msg);
}

module.exports = { logError, logInfo };
