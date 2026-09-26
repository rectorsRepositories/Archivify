# Home Archive

The archive API reads the SQLite index and serves metadata and indexed files. It
runs independently of the Vite client.

## Set up a fresh clone

Install Git and Node.js 22 or newer with npm. On the machine that will host the
archive, clone the repository and install its dependencies from the lockfile:

```sh
git clone <repository-url> home-archive
cd home-archive
npm ci
```

The media in `archive/`, the SQLite database in `data/`, and `.env` are ignored by
Git, so a clone does not contain them. Copy or mount your media separately. By
default, the indexer looks in `/Archive`; otherwise set `ARCHIVE_ROOT` to the
directory containing the case-sensitive `Music`, `Games`, `Pictures`, and `Videos`
folders. The server must be able to read the media and write the database
directory. On a new machine, create a fresh index rather than copying a database
whose file records contain absolute paths from another machine.

## Environment variables

Set variables in the shell before running an npm command, or configure them in
the environment of the service that starts the application. For example, from
the repository root on Ubuntu:

```sh
export ARCHIVE_ROOT=/srv/home-archive/archive
export ARCHIVE_DB=/srv/home-archive/data/archive.db
export HOST=127.0.0.1
export PORT=3000
```

Only `ARCHIVE_ROOT` needs to be set if the media is not mounted at `/Archive`;
the other values above show their defaults. Relative paths are resolved from the
directory where the command is run, so use absolute paths for a server service.
Variables set with `export` apply to the current shell and commands it starts.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ARCHIVE_ROOT` | `/Archive` | Media root scanned by `index:files`; contains `Music`, `Games`, `Pictures`, and `Videos`. |
| `ARCHIVE_DB` | `data/archive.db` in the repository | SQLite index used by the API and all three indexers. Its parent directory is created if needed. |
| `HOST` | `127.0.0.1` | Address where the API listens when started with `npm start` or by `npm run dev` / `npm run preview`. Use `0.0.0.0` only when the API itself should accept network connections. |
| `PORT` | `3000` | API port, also used by the Vite `/api` proxy. Must be an integer from 1 to 65535. |
| `IGDB_CLIENT_ID` | unset | Optional Twitch developer application client ID for game metadata lookup during indexing. |
| `IGDB_CLIENT_SECRET` | unset | Optional matching client secret. Both IGDB credentials must be set for lookup; neither is needed to serve the API. |
| `IGDB_REFRESH` | unset | Set to `1` for an indexing run to look up games that already have IGDB matches again. |

An `.env` file can hold local values and is ignored by Git, but the current npm
scripts do **not** load it automatically. On Ubuntu, load a shell-compatible
`.env` file before running commands with `set -a; . ./.env; set +a`, or export
the variables directly. Keep credentials out of the repository.

## Build the index

From the repository root, after the archive is mounted and the environment is
set, run:

```sh
npm run index
```

This runs `index:files`, then `index:music`, then `index:games`. The file indexer
scans the four category folders and stores absolute file paths in SQLite. The
music and game indexers read those file records to add metadata. Run the full
command again after adding or changing files. To run a stage separately, use
`npm run index:files`, `npm run index:music`, or `npm run index:games`; run the
file stage first when the archive contents have changed.

The file indexer leaves records for deleted files in place by default. After
confirming that the archive is mounted and readable, remove stale records with:

```sh
npm run index:files -- --prune
npm run index:music
npm run index:games
```

Missing category folders are reported and skipped. On a new machine, use a new
database so old absolute file paths do not remain in the index.

The game indexer recognizes `.iso`, `.chd`, `.cso`, and `.zso` disc images under
`Games/<platform>/`. BIOS files remain in the generic file index. For optional
IGDB metadata and cover art, set `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` from a
Twitch developer application before running `npm run index:games`. The indexer
stores matched metadata locally; the API needs no IGDB credentials at runtime.
Matching requires both the title and platform to agree, so unmatched games keep
their filename title and nullable metadata. A `<game name>.game.json` file beside
the disc image can override `title`, `platform`, `release_year`, and `genre`; a
matching `.jpg`, `.jpeg`, `.png`, or `.webp` file is used as local cover art.

## Start the API and client

For development, run `npm run dev` from the repository root. It uses an API
already available at `http://127.0.0.1:3000/api/v1/health`, or starts one, then
starts Vite on port 5173 and proxies `/api` to the local API. The current Vite
development configuration listens on `0.0.0.0`, so another device on the same
network can open `http://<server-lan-ip>:5173` if the firewall permits it. Keep
the command running while using the client.

To start only the API, run `npm start`. It listens at
`http://127.0.0.1:3000/api/v1` by default; this command does not serve the
client. To build and inspect the client, run:

```sh
npm run build
npm run preview
```

The build goes into `client/dist`. Preview starts or reuses the API and serves
the built client, with `/api` proxied to the local API. The current preview
configuration listens on `0.0.0.0` (Vite's default preview port is 4173), so
it is local to the server unless you change that configuration or put it behind
a reverse proxy. Music and games pages use indexed data.

## API

All endpoints are under /api/v1 and currently support GET and HEAD.

| Endpoint | Purpose |
| --- | --- |
| /health | Check server and database availability |
| /library/summary | File totals by category, music totals, and game totals |
| /files | Search and list indexed files |
| /files/:id | File metadata |
| /files/:id/content | Inline file content, including byte ranges |
| /files/:id/download | File content as an attachment |
| /music/artists | Search and list artists |
| /music/artists/:id | Artist details |
| /music/albums | Search and list albums |
| /music/albums/:id | Album details |
| /music/albums/:id/tracks | Ordered album tracks |
| /music/albums/:id/artwork | Cover file or embedded image |
| /music/albums/:id/download | ZIP of the indexed album folder |
| /music/tracks | Search and list tracks |
| /music/tracks/:id | Track details |
| /games | Search and list indexed games |
| /games/:id | Game details, metadata, artwork URL, and download URL |

Lists accept limit (default 30, maximum 100) and offset. File filters are q,
category, extension, and path (a relative path prefix). Album filters are q,
artist_id, year, and genre. Track filters also accept album_id. Artist lists
accept q.
Game filters are q, platform, genre, and year.

List responses contain data and pagination (limit, offset, total). Detail
responses contain data. Sizes are bytes, durations are milliseconds, and missing
music tags are null. File paths in JSON are relative to their archive category;
the API never accepts an arbitrary filesystem path for file delivery. Album
downloads stream a ZIP containing the indexed album folder, including sidecar
files such as cover images when present.
