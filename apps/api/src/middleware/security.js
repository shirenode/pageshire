"use strict";

const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { SUPABASE_URL } = require("../config");

const security = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      "worker-src": ["'self'", "blob:", "https://cdn.jsdelivr.net"],
      "img-src": ["'self'", "data:", "blob:"],
      "connect-src": [
        "'self'",
        ...(SUPABASE_URL ? [SUPABASE_URL] : []),
        "https://*.supabase.co",
        "https://cdn.jsdelivr.net",
      ],
      "upgrade-insecure-requests": null,
    },
  },
  strictTransportSecurity: false,
});

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

module.exports = { security, limiter };
