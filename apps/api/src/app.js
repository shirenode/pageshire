/**
 * app.js — Express application factory.
 *
 * Creates and configures the Express app with:
 *  - Security middleware (Helmet CSP, rate-limiting)
 *  - Static file serving for the web frontend
 *  - API routes (merge, convert, edit, health, config)
 *  - A global error handler for multer / general errors
 */
"use strict";

const express = require("express");
const path = require("path");
const { security } = require("./middleware/security");
const errorHandler = require("./middleware/errorHandler");
const routes = require("./routes");

/**
 * Build and return a fully configured Express app.
 * @param {Object} [opts]
 * @param {string} [opts.staticDir] - Override the directory used for serving
 *   static frontend assets. Defaults to `apps/web/public`.
 */
function createApp({ staticDir } = {}) {
  const app = express();

  // Hide the "X-Powered-By: Express" header to reduce fingerprinting.
  app.disable("x-powered-by");

  // Apply Helmet (CSP, HSTS, etc.) and any other security-related middleware.
  app.use(security);

  // Serve the static web frontend (HTML, CSS, client-side JS).
  const webDir = staticDir || path.resolve(__dirname, "../../web/public");
  app.use(express.static(webDir));

  // Mount all API routes (/merge, /convert, /edit, /healthz, /config).
  app.use(routes);

  // Catch-all error handler (must be registered last).
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
