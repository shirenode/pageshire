/**
 * server.js — Application entry point.
 *
 * Creates the Express app via createApp() and, when run directly
 * (i.e. `node src/server.js`), starts an HTTP server on the configured PORT.
 *
 * When imported as a module (e.g. by the Vercel serverless wrapper in
 * api/index.js), the server is NOT started — only the `app` instance
 * is exported so the hosting platform can handle incoming requests itself.
 */
"use strict";

const { createApp } = require("./app");
const { PORT } = require("./config");
const { logInfo } = require("./utils/logger");

// Build the Express application (middleware, routes, static files, etc.)
const app = createApp();

let server;

// Only bind to a port when this file is executed directly (not imported).
if (require.main === module) {
  server = app.listen(PORT, () => {
    logInfo(`Pageshire running at http://localhost:${PORT}`);
  });

  /**
   * Graceful shutdown handler.
   * On SIGTERM/SIGINT, stop accepting new connections and let in-flight
   * requests finish. Force-exit after 10 seconds to avoid hanging forever.
   */
  const shutdown = (signal) => {
    logInfo(`Received ${signal}, shutting down gracefully...`);
    if (!server) return process.exit(0);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = { app };
