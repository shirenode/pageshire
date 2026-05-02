"use strict";

const { createApp } = require("./app");
const { PORT } = require("./config");
const { logInfo } = require("./utils/logger");

const app = createApp();

let server;
if (require.main === module) {
  server = app.listen(PORT, () => {
    logInfo(`Pageshire running at http://localhost:${PORT}`);
  });

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
