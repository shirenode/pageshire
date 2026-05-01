# Pageshire

A friendly Node.js + Express web app for working with PDFs: merge files, convert PNG/JPEG to PDF, and edit pages (reorder, rotate, delete, watermark, page numbers).

## Features

- Merge two or more PDFs into one (`POST /merge`).
- Convert PNG/JPEG images into a single PDF (`POST /convert`) with optional `pageSize=fit|a4|letter`.
- Drag-and-drop UI with reorder, thumbnails, total-size warning, upload progress, cancel button, dark mode, and keyboard a11y.
- Security: `helmet`, basic rate limiting, strict file-type filtering, per-file and total upload size limits.
- Health check at `GET /healthz`.

## Setup

```bash
npm install
npm start
```

The server listens on `http://localhost:3000` by default.

## Environment variables

| Var | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `MAX_FILE_BYTES` | `52428800` (50 MB) | Per-file size limit |
| `MAX_TOTAL_BYTES` | `209715200` (200 MB) | Total upload size per request |
| `MAX_FILES` | `50` | Max files per request |
| `SUPABASE_URL` | _(empty)_ | Your Supabase project URL (e.g. `https://xyz.supabase.co`). Required for sign-in. |
| `SUPABASE_ANON_KEY` | _(empty)_ | Supabase anon/public key. Safe to expose to the browser. |
| `FREE_MERGE_LIMIT` | `1` | Number of free merges/conversions before the paywall is shown. |
| `UPGRADE_URL` | _(empty)_ | URL the "Upgrade to Pro" button opens (e.g. a Stripe Checkout link). |

## Auth & paywall

The frontend includes a sign-in button (account icon, top-right) backed by Supabase magic-link
auth and a paywall modal that appears once the user exceeds `FREE_MERGE_LIMIT` merges/conversions
in the current browser.

To enable sign-in:

1. Create a Supabase project and copy its URL + anon key.
2. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` env vars before starting the server.
3. In Supabase Auth settings, add `http://localhost:3000` (and your production origin) to the
   list of allowed redirect URLs.
4. To grant a user "Pro" status (unlimited usage), set `pro: true` in their `user_metadata` or
   `app_metadata` from the Supabase dashboard.
5. (Optional) Set `UPGRADE_URL` to your Stripe Checkout / payment link.

> Note: the free-usage counter is stored in `localStorage` and is intended as a soft client-side
> gate. For hard enforcement, verify the Supabase JWT on the server in the `/merge` and
> `/convert` handlers and reject unauthenticated requests over the limit.

## Scripts

- `npm start` – run the server
- `npm test` – run the supertest-based test suite
- `npm run lint` – run ESLint

## API

### `POST /merge`
- Body: `multipart/form-data` with field `files` (≥ 2 PDFs)
- Optional query: `?name=output` (sanitized, used as filename)
- Response: `application/pdf`

### `POST /convert`
- Body: `multipart/form-data` with field `files` (≥ 1 PNG or JPEG)
- Optional query: `?pageSize=fit|a4|letter`, `?name=output`
- Response: `application/pdf`

### `GET /healthz`
- Response: `{ "status": "ok", "uptime": <seconds> }`

