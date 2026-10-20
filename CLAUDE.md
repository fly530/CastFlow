# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

CastFlow is a self-hosted automated radio station: Liquidsoap mixes audio, Icecast serves an MP3 stream, Liquidsoap also writes HLS segments, a Node.js server does all the scheduling, and an Nginx gateway serves a single React SPA (listener player + admin console). Code comments, commit messages and UI strings are mostly Traditional Chinese; README/project-context exist in both English and zh-TW and should be kept in sync when edited.

## Commands

Backend (`server/`, Node 26, ESM, Express 5):
```bash
cd server && npm ci
npm test                                   # node --test test/*.test.js
node --test --test-name-pattern="路徑穿越" test/security.test.js   # single describe/test by name
npm run dev                                # node --watch src/index.js (needs JWT_SECRET ≥32 chars and a reachable Liquidsoap telnet)
npm audit --audit-level=high               # CI gate
```

Frontend (`frontend/`, React 18 + Vite + Tailwind v4):
```bash
cd frontend && npm ci
npm run dev      # Vite on :3000, proxies /api and /ws to localhost:3001 (override with VITE_API_URL / VITE_WS_URL)
npm run build    # CI gate; there is no linter or frontend test suite
```

Full stack: create `.env` (see README — `JWT_SECRET`, `ICECAST_SOURCE_PASSWORD`, `ICECAST_ADMIN_PASSWORD`) then `docker compose up -d`. Note `docker-compose.yml` **pulls** `ghcr.io/fly530/castflow-server` / `castflow-gateway` images rather than building local source; to test local server/gateway changes in compose you must build those images yourself. `compose.komodo.yaml` is the Traefik/Komodo production variant.

CI (`.github/workflows/release.yml`): npm audit (server, frontend prod deps) → `npm test` in server → frontend build → build/push both images to GHCR on `main`/tags.

## Architecture

**Scheduling lives entirely in Node, not Liquidsoap.** `liquidsoap/radio.liq` only has a `request.queue` (`dynamic_queue`), a fallback that shuffles `/music/A` when the queue is empty, crossfade + limiter, and the two outputs (Icecast MP3, HLS to a tmpfs shared with the gateway). It has no time-of-day logic. `server/src/scheduler.js` runs a 5 s AutoDJ loop (`checkAndFeedQueue`) that keeps ~3 tracks in `dynamic_queue` by pushing file paths over Telnet (`server/src/telnet.js`, port 1234). The loop starts on Telnet `connect` and stops on `disconnect` (`index.js`). Consequence: if the server is down, the station silently degrades to A-only shuffle. Schedule edits take effect without reloading Liquidsoap.

`decideNextTrack()` priority order: `fixed_time` / `hourly` rules (by `priority`, deduped per minute via an in-memory map) → `interval` rules (every N tracks, based on an in-memory played counter) → weighted random among active `continuous` rules → first active playlist with files. Scheduler state (shuffle indices, `plannedQueue` mirroring what was pushed, counters) is in-memory and resets on restart. `interrupt_mode: 'immediate_fade'` triggers `dynamic_queue.flush_and_skip`.

**Data**: SQLite via better-sqlite3 (WAL) at `$DATA_DIR/radio.db` (`server/src/db.js`). `initDatabase()` creates tables and, when empty, seeds playlists A–G with their default schedules and an admin user with a random `cf_…` password printed to the log. Playlists map to folders under `$MUSIC_DIR` (`playlists.js`); tracks are just `.mp3` files on disk (no track table), with ID3 read via `music-metadata` (`metadata.js`). Backups go to `$BACKUP_DIR` (`backup.js`).

**API**: `server/src/api.js` is one Express router mounted at `/api`; admin routes use the JWT middleware from `auth.js`. `websocket.js` polls status (Telnet + Icecast JSON stats from `icecast.js`) and broadcasts `RADIO_STATUS` on `/ws`. `/health` is mounted outside `/api`.

**Gateway** (`gateway/nginx.conf`, built by `gateway/Dockerfile` with build context = repo root because it compiles `frontend/`): serves the SPA, `/hls/` from the shared tmpfs, proxies `/api/`, `/ws` to `server:3001` and `/stream` to Icecast. Runs as `nginx-unprivileged` on port 8080 (mapped to 80).

**Frontend**: one SPA; `App.jsx` picks `PlayerView` vs `AdminView` from whether the path starts with `/admin`. API helpers and JWT (localStorage key `castflow_jwt`) are in `src/utils/api.js`.

## Security invariants (enforced by `server/test/security.test.js`)

These were fixed deliberately; the tests run real code paths, so don't loosen them or duplicate their logic in tests:
- No `execSync` anywhere in `server/src` — use `execFileSync` with an argument array (ZIP upload extraction uses `/usr/bin/unzip` this way).
- Playlist folders are sanitized before DB write and re-validated in `getPlaylistDir` so they can never escape `MUSIC_DIR`; unsafe folders fall back to the playlist id.
- Track delete/move only accept `.mp3` basenames.
- `server/Dockerfile` must set a non-root `USER`; gateway must use `nginx-unprivileged` on a non-privileged port.
- `auth.js` exits at import time if `JWT_SECRET` is missing, shorter than 32 chars, or a known placeholder (tests set env vars *before* importing modules for this reason).

## Gotchas

- Icecast image is `libretime/icecast`: the env var is `ICECAST_SOURCE_PASSWORD` (not `ICECAST_PASSWORD`, which is silently ignored). A mismatch breaks only `/stream` while HLS keeps working.
- Compose injects a UTF-8 `<charset>` into the Icecast config at startup so CJK titles aren't shown as `*` on `/stream`.
- Host bind-mounted dirs must be writable by uid 1000 (server runs as `node`).
