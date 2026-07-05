# Otero

A Zotero-like literature management system implemented in pure JavaScript, with SQLite for metadata storage and a dedicated directory for PDFs and other attachment files.

## Features

- EAV-style schema modeled on Zotero (`items` + `itemData` + `itemDataValues`), flexible for different item types.
- PDF import pipeline that extracts embedded metadata and the first-page text, then queries CrossRef / arXiv / OpenLibrary by DOI / arXiv ID / ISBN to fill in rich metadata.
- File storage under `data/storage/<key-prefix>/<key>.pdf`, mirroring Zotero's layout.
- CLI for batch imports and listing.
- REST API for programmatic access.

## Requirements

- Node.js >= 20
- Native build toolchain for `better-sqlite3` (or use prebuilt binaries)

## Setup

### Backend

```bash
npm install
npm run migrate   # create SQLite schema
npm run seed      # seed itemTypes / fields / creatorTypes
```

### Web frontend (Vite + React + shadcn/ui)

```bash
cd web
npm install
npm run dev       # dev server at http://127.0.0.1:5173, proxies /api to :3000
npm run build     # production build into web/dist (served by the API server)
```

In development, run the API server (`npm run cli serve` from repo root) and the
Vite dev server (`npm run dev` in `web/`) side by side. Vite proxies `/api` and
`/health` to `http://127.0.0.1:3000`.

In production, build the frontend (`cd web && npm run build`) then start the API
server — it serves `web/dist/` statically with SPA fallback.

## Usage

```bash
# Import PDFs via CLI
node src/cli/index.js import path/to/paper1.pdf path/to/paper2.pdf

# List items
node src/cli/index.js list
node src/cli/index.js list --type journalArticle --tag "machine learning"

# Start REST API + web UI server
node src/cli/index.js serve --port 3000
# Then open http://127.0.0.1:3000 in a browser
```

## REST API

- `GET    /api/items`            list items (`?type=&tag=&collection=`)
- `GET    /api/items/:key`       item detail
- `POST   /api/items`            create item
- `PATCH  /api/items/:key`       update fields
- `DELETE /api/items/:key`       soft delete
- `POST   /api/import/pdf`       multipart upload PDF, runs recognition pipeline
- `GET/POST/DELETE /api/collections`
- `GET/POST/DELETE /api/tags`

## Layout

```
data/                 runtime data (gitignored)
  otero.db
  storage/<key[0:2]>/<key>.pdf
src/                  backend (Node.js, ESM)
  db/                 connection, schema, migrations, seed
  models/             Item / Collection / Tag / Attachment
  repositories/       SQL access layer
  services/           importService, pdfParser, recognizers, storage
  api/                express server + routes
  cli/                commander entry
  utils/              key / doi / isbn helpers
web/                  frontend (Vite + React + shadcn/ui)
  src/components/ui/  shadcn/ui components
  src/components/     app components (Sidebar, ItemTable, ItemDetail, TopBar)
  src/api/            REST client
  src/hooks/          useAsync data-fetching hook
docs/                 analysis notes
deps/zotero/          reference source (git submodule)
```

See `docs/zotero-data-format-analysis.md` and `docs/zotero-pdf-metadata-extraction.md` for the design rationale.
