"use strict";

function logError(reqId, label, err) {
  // eslint-disable-next-line no-console
  console.error(`[${reqId}] ${label}:`, err && err.stack ? err.stack : err);
}

function logInfo(msg) {
  // eslint-disable-next-line no-console
  console.log(msg);
}

module.exports = { logError, logInfo };
