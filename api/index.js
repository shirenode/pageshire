// Vercel serverless entry — re-exports the Express app from server.js.
const { app } = require("../server.js");
module.exports = app;
