"use strict";

const express = require("express");
const path = require("path");
const { security } = require("./middleware/security");
const errorHandler = require("./middleware/errorHandler");
const routes = require("./routes");

function createApp({ staticDir } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(security);

  const webDir = staticDir || path.resolve(__dirname, "../../web/public");
  app.use(express.static(webDir));

  app.use(routes);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
