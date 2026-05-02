// Vercel serverless entry — re-exports the Express app.
const { app } = require("../apps/api/src/server.js");
module.exports = app;
