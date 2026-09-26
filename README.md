# Home Archive

The archive API reads the SQLite index and serves metadata and indexed files. It
runs independently of the Vite client.

## Run

Install dependencies with npm install. Set ARCHIVE_ROOT to the archive directory
when it is not mounted at /Archive, then run npm run index to index files followed
by music metadata. Start the API with npm start.

The API listens on http://127.0.0.1:3000 by default. Set HOST and PORT to change
the listening address. Set ARCHIVE_DB to use a database other than data/archive.db.

## API

All endpoints are under /api/v1 and currently support GET and HEAD.

| Endpoint | Purpose |
| --- | --- |
| /health | Check server and database availability |
| /library/summary | File totals by category and music totals |
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
| /music/tracks | Search and list tracks |
| /music/tracks/:id | Track details |

Lists accept limit (default 30, maximum 100) and offset. File filters are q,
category, extension, and path (a relative path prefix). Album filters are q,
artist_id, year, and genre. Track filters also accept album_id. Artist lists
accept q.

List responses contain data and pagination (limit, offset, total). Detail
responses contain data. Sizes are bytes, durations are milliseconds, and missing
music tags are null. File paths in JSON are relative to their archive category;
the API never accepts an arbitrary filesystem path for file delivery.
