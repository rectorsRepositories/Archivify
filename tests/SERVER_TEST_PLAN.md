# Server test plan

Scope: `src/server.js`, `src/http.js`, `src/routes/`, `src/services/`,
`src/db/`, and `src/indexers/`. Client code, Vite, and browser behavior are out
of scope. The coverage targets below now have corresponding test suites.

## Current baseline

`npm test` uses Node's built-in test runner. The suites now cover Priority 1 API
behavior, file and game indexing, music indexing with generated WAV and injected
metadata, schema constraints, music API and album ZIP delivery, and mocked IGDB
requests. Search index backfill, updates, and unchanged substring results are
covered as well. The suites use temporary files and SQLite databases. API tests start
the server in a separate process on an ephemeral localhost port.

`tests/fileIndexer.test.js` injects symlink directory entries and a directory
read error so traversal and prune safety cases run on hosts where creating
actual symlinks or changing permissions is restricted.

## Test harness and fixtures

- Use `node:test` and `node:assert/strict`; avoid a new test framework. Each
  integration test gets a fresh temporary archive tree and `ARCHIVE_DB` path.
- Set `ARCHIVE_ROOT`, `ARCHIVE_DB`, and IGDB variables explicitly in child process
  environments. Never point tests at the repository's real `archive/` or
  `data/archive.db`.
- Put shared helpers in `test-support/`: create four category folders, write
  small fixture files, run an indexer process, seed SQLite through the real
  schema, start the API on an ephemeral localhost port, and clean up resources.
- For API tests, start `createServer()` only after setting `ARCHIVE_DB` in an
  isolated process. The database module opens a connection at import time;
  changing the environment after importing it does not switch databases.
- Keep ordinary media fixtures tiny. For music metadata tests, use one small
  valid audio fixture with known tags and artwork, plus tagless/corrupt samples.
  Do not depend on the user's archive. Stub `fetch` for IGDB tests; no live
  credentials or internet requests in `npm test`.
- Assert response status, headers, body, and database state where relevant.
  Prefer behavioral assertions over snapshots of full JSON responses.

## Priority 1: core API and file delivery

| Area | Coverage targets | Expected contract |
| --- | --- | --- |
| Server and `http.js` | Health GET/HEAD; unknown route; unsupported method and `Allow`; JSON error shape; invalid IDs, years, limits, offsets, and oversized text filters | Correct status, headers, body; HEAD has no body; invalid input returns 400; methods return 405 |
| File lists and summary | Empty database; combined q/category/extension/path filters; path segment boundary; sorting; default, max, and offset pagination; totals independent of page size | Relative paths and URLs only; stable ordering; category and aggregate counts match seeded rows |
| File content/download | Full GET/HEAD; known MIME and binary fallback; attachment filename encoding; empty file; missing DB row; indexed path removed from disk | Correct bytes and headers; 404 for missing rows or unavailable files; no arbitrary path input |
| Byte ranges | Closed, open ended, and suffix ranges; oversized end; malformed and unsatisfiable ranges; unsupported units, multipart requests, `If-Range`, and HEAD | 206 and exact `Content-Range`/length for valid GET ranges; 416 for malformed/unsatisfiable byte ranges; full responses when ranges are unsupported or cannot apply |
| Games API | List/detail, q/platform/genre/year filters, pagination, 404, local cover vs IGDB cover URL precedence | Response fields and URLs agree with DB rows and filters |

## Priority 2: indexing and data lifecycle

| Area | Coverage targets | Expected contract |
| --- | --- | --- |
| File indexer | Recursive scan; ignore names/extensions; extension case; symlinked file vs directory; same file unchanged on rescan; size/mtime update | Correct rows and stable IDs; `indexed_at` changes only for changed files |
| File pruning | Default retains missing files; `--prune` removes only stale rows in completely scanned categories; absent/unreadable category cannot prune | No data loss from incomplete scans; foreign-key cascades/set-null behave as schema declares |
| Game indexer | Platform folders, BIOS/support exclusions, title cleanup, same-stem cover, sidecar overrides, malformed sidecar, extra extension validation, repeated run | Correct metadata and stable game IDs; bad sidecar does not stop unrelated games |
| Music indexer | Path/format folder parsing, track/disc numbers, tag vs filename fallback, multi-artist tags, cover priority, embedded artwork fallback, metadata read failure, repeat run/retag | Correct album/track/artist links, stable IDs, no duplicate links, artwork replacement and duration units |
| Database schema | Fresh DB initialization, repeated initialization, uniqueness, foreign keys, cascade and set-null behavior | Indexers and API can share the schema safely |

## Priority 3: music API, ZIP, and IGDB boundary

| Area | Coverage targets | Expected contract |
| --- | --- | --- |
| Music lists/details | Artist, album, track filters and search; ordering across discs; pagination; missing records; album counts, bytes, duration with one missing duration | Consistent totals, nullable metadata, and correct related URLs |
| Album artwork | Local file, embedded image, no artwork, missing source file, GET/HEAD | Correct bytes, MIME, length, and 404 behavior |
| Album ZIP | Includes tracks and indexed sidecars under one album folder; excludes similarly prefixed albums; handles unsafe/colliding names; missing file; GET/HEAD | Valid ZIP, safe unique entry names, 409 on incomplete album, HEAD without body |
| IGDB client | Exact title/platform and alternative title matching; platform aliases; token failures; escaped query input; 429 retry; search errors | Deterministic matching and graceful indexing fallback without live requests |

## Suite map

- `tests/serverApi.test.js`: server, HTTP helpers, files, downloads, and games API.
- `tests/fileIndexer.test.js`, `tests/gameIndexer.test.js`, and
  `tests/gameMetadata.test.js`: file/game indexing and rescan behavior.
- `tests/musicIndexer.test.js`: real WAV parsing and deterministic edge cases.
- `tests/schema.test.js`: schema initialization, uniqueness, and foreign keys.
- `tests/musicApi.test.js`: music service/routes, artwork, and album ZIPs.
- `tests/igdb.test.js`: matching, authentication, request escaping, and retry.
- `tests/searchIndex.test.js`: FTS backfill, synchronization, and search behavior.

GitHub Actions runs these tests on Windows and Ubuntu with Node.js 22 and 24.
`npm run benchmark:search` compares the substring scan with the FTS candidate
path on synthetic in-memory data.

Run `npm test` after changes. Keep each suite independent and safe for the test
runner's parallel file execution.
