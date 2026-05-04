/**
 * security.js — Security middleware: HTTP headers + rate limiting.
 *
 * Uses Helmet to set strict Content-Security-Policy headers so the
 * browser only loads scripts/styles/images/connections from trusted
 * origins (self, jsdelivr CDN, Supabase).
 *
 * Also exports an express-rate-limit instance (`limiter`) that caps
 * each IP to 30 requests per minute on the PDF operation endpoints.
 */
"use strict";

const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { SUPABASE_URL } = require("../config");

// Helmet: sets Content-Security-Policy, X-Content-Type-Options, etc.
const security = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // Allow inline scripts (needed for the single-page frontend) and CDN libs.
      "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      // PDF.js uses web workers loaded from blobs and the CDN.
      "worker-src": ["'self'", "blob:", "https://cdn.jsdelivr.net"],
      // Allow data URIs (PDF thumbnails) and blob URLs (download links).
      "img-src": ["'self'", "data:", "blob:"],
      // The frontend needs to talk to Supabase for auth and to the CDN.
      "connect-src": [
        "'self'",
        ...(SUPABASE_URL ? [SUPABASE_URL] : []),
        "https://*.supabase.co",
        "https://cdn.jsdelivr.net",
      ],
      // Disable auto-upgrade to HTTPS so local dev (http://localhost) works.
      "upgrade-insecure-requests": null,
    },
  },
  // HSTS disabled — the deployment platform (Vercel) handles TLS itself.
  strictTransportSecurity: false,
});

/**
 * IP-based rate limiter.
 * 30 requests per 60-second window, using standard RateLimit-* headers.
 */
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

module.exports = { security, limiter };
