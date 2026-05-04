/**
 * logger.js — Minimal structured logging utilities.
 *
 * - logError(reqId, label, err): Prints an error to stderr, prefixed with
 *   the request UUID so it can be correlated with other log lines for the
 *   same request.
 *
 * - logInfo(msg): Prints an informational message to stdout (e.g. server
 *   startup, graceful shutdown signals).
 */
"use strict";

function logError(reqId, label, err) {
  console.error(`[${reqId}] ${label}:`, err && err.stack ? err.stack : err);
}

function logInfo(msg) {
  console.log(msg);
}

module.exports = { logError, logInfo };
