// Vercel serverless entry point.
// Vercel expects a default export (or module.exports) of an Express app
// at the path matched by vercel.json's "rewrites" rule.
// This file simply re-exports the fully configured Express app from the API
// workspace so Vercel can invoke it as a serverless function.
const { app } = require("../apps/api/src/server.js");
module.exports = app;
