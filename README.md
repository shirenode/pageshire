# PDF Toolbox

A small Node.js + Express web app to merge PDFs and convert PNG/JPEG images to PDF.

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

