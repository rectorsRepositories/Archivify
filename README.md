# Home Archive

The archive API reads the SQLite index and serves metadata and indexed files. It
runs independently of the Vite client.

## Run

Install dependencies with npm install. Set ARCHIVE_ROOT to the archive directory
when it is not mounted at /Archive, then run npm run index to index files,
music metadata, and games. Start the API with npm start.

The game indexer recognizes `.iso`, `.chd`, `.cso`, and `.zso` disc images under
`Games/<platform>/`. BIOS files remain in the generic file index. For optional
IGDB metadata and cover art, set `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` from a
Twitch developer application before running `npm run index:games`. The indexer
stores matched metadata locally; the API needs no IGDB credentials at runtime.
Set `IGDB_REFRESH=1` during indexing to look up already matched games again.
Matching requires both the title and platform to agree, so unmatched games keep
their filename title and nullable metadata. A `<game name>.game.json` file beside
the disc image can override `title`, `platform`, `release_year`, and `genre`; a matching
`.jpg`, `.jpeg`, `.png`, or `.webp` file is used as local cover art.

The API listens on http://127.0.0.1:3000 by default. Set HOST and PORT to change
the listening address. Set ARCHIVE_DB to use a database other than data/archive.db.

To run the client during development, run npm run dev. It starts the API if it is
not already running, then starts Vite at http://127.0.0.1:5173 with an /api proxy.
npm run preview does the same for a built client. Music and games pages use
indexed data.

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
