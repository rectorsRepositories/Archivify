# Home Archive

<!-- ![Home Archive homepage](homepage.png) -->
<p align="center">
  <img src="homepage.png" alt="Project Banner" width="600">
</p>


Home Archive indexes media in a local SQLite database. Its API serves metadata
and indexed files, and the Vite client provides a browser interface. The API
can run independently of the client.

## Set up a fresh clone

Install Git and Node.js 22 or newer with npm. On Ubuntu, install the native
build tools first: `better-sqlite3` may need to compile during `npm ci`.

```sh
sudo apt update
sudo apt install -y build-essential python3
```

Clone the repository on the machine that will run the archive, then install
dependencies from the lockfile:

```sh
git clone <repository-url> home-archive
cd home-archive
npm ci
```

If an earlier `npm ci` failed with `gyp ERR! stack Error: not found: make`, run
the Ubuntu prerequisite commands above and retry `npm ci` in the repository.

Media in `archive/`, the SQLite database in `data/`, and `.env` are ignored by
Git, so a clone does not contain them. Copy or mount your media separately. Set
`ARCHIVE_ROOT` to the directory containing the `Music`, `Games`, `Books`,
`Pictures`, and `Videos` folders. Folder names must match that capitalization
on case-sensitive file systems. If `ARCHIVE_ROOT` is unset, the indexer and API use the test
archive in the repository's `archive/` directory on Windows and the production
archive at `/Archive` on other systems. The process must be able to read the
media and write to the database directory. The API resolves indexed files from
their category and relative path under the current archive root, so an index
copied from another machine can still serve files in the same layout.

## Environment variables

Set variables in the shell before running an npm command, or configure them in
the environment of the service that starts the application. For example, from
the repository root, use the syntax for your shell:

**POSIX shell (Linux or macOS):**

```sh
export ARCHIVE_ROOT="$(pwd)/archive"
```

**PowerShell (Windows, Linux, or macOS):**

```powershell
$env:ARCHIVE_ROOT = (Join-Path (Get-Location) 'archive')
```

These examples assume the media is in the repository's `archive/` directory;
use the path to your media if it is elsewhere. The other variables are optional.
Relative paths are resolved from the directory where the command is run, so
use absolute paths for a service. Shell variables apply to that shell session
and the commands it starts.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ARCHIVE_ROOT` | Repository `archive/` on Windows; `/Archive` elsewhere | Media root scanned by `index:files` and served by the API; contains `Music`, `Games`, `Books`, `Pictures`, and `Videos`. |
| `ARCHIVE_DB` | `data/archive.db` in the repository | SQLite index used by the API and all four indexers. Its parent directory is created if needed. |
| `HOST` | `127.0.0.1` | Address where the API listens when started with `npm start` or by `npm run dev` / `npm run preview`. Use `0.0.0.0` only when the API itself should accept network connections. |
| `PORT` | `3000` | API port, also used by the Vite `/api` proxy. Must be an integer from 1 to 65535. |
| `IGDB_CLIENT_ID` | unset | Optional Twitch developer application client ID for game metadata lookup during indexing. |
| `IGDB_CLIENT_SECRET` | unset | Optional matching client secret. Both IGDB credentials must be set for lookup; neither is needed to serve the API. |
| `IGDB_REFRESH` | unset | Set to `1` for an indexing run to look up games that already have IGDB matches again. |
| `GAME_EXTRA_EXTENSIONS` | unset | Optional comma- or space-separated extra game file suffixes for `index:games`, such as `.rom,.foo`. Leading dots and letter case are optional. |

An `.env` file can hold local values and is ignored by Git, but the npm scripts
do **not** load it automatically. Load its values using a method supported by
your shell or process manager, or set the variables directly before running
commands. Keep credentials out of version control.

## Build the index

From the repository root, after the media is available and `ARCHIVE_ROOT` is
set if needed, run:

```sh
npm run index
```

This runs `index:files`, then `index:music`, then `index:games`, then `index:books`.
The file indexer scans the five category folders and stores absolute file paths
in SQLite. The music, game, and book indexers read those file records to add
metadata. Run the full command again after adding or changing files. To run a stage separately, use
`npm run index:files`, `npm run index:music`, `npm run index:games`, or
`npm run index:books`; run the
file stage first when the archive contents have changed.

The file indexer leaves records for deleted files in place by default. After
confirming that the media is available and readable, remove stale records with:

```sh
npm run index:files -- --prune
npm run index:music
npm run index:games
npm run index:books
```

Missing category folders are reported and skipped. On a new machine, use a new
database so old absolute file paths do not remain in the index.

After `--prune` removes music files, `index:music` removes albums with no tracks
and artists with no remaining album or track links. Run both stages in the order
shown above. An album whose only track was renamed keeps its ID when the new
track is indexed in the same album folder.

The game indexer accepts any `Games/<platform>/` folder name. It recognizes
common disc images (`.iso`, `.chd`, `.cso`, `.zso`, `.ciso`, `.gcm`, `.rvz`, `.wbfs`,
`.cdi`, `.pbp`) and console formats including `.nes`, `.sfc`, `.smc`, `.n64`,
`.z64`, `.gb`, `.gbc`, `.gba`, `.nds`, `.3ds`, `.sms`, `.gg`, `.md`, `.gen`, `.xci`,
and `.nsp`. Other supported suffixes are listed in `src/indexers/gameIndexer.js`.
For an uncommon format, set `GAME_EXTRA_EXTENSIONS` before running
`npm run index:games`; the file must first be in the generic file index.
The game indexer groups multi-file disc images from `.cue` track references,
`.gdi` track lists, and `.ccd`/`.img`/`.sub` or `.mds`/`.mdf` companion sets.
An `.m3u` playlist groups its referenced discs in playlist order. Without a
playlist, files named with `(Disc 1)`, `(Disc 2)`, etc. are grouped when they
share a folder and the rest of the filename matches. A neighboring `.game.json`
can explicitly list disc entry files for unusual layouts, for example:

```json
{"title":"Example Game","discs":["Example A.cue","Example B.cue"]}
```

Save this as `Example A.game.json` beside `Example A.cue`; the first `discs`
path must refer to that entry file.

Paths in `discs`, playlists, and cue sheets are relative to the file containing
them and must stay within the same platform directory. Missing referenced files
cause an incomplete disc or playlist to be skipped. Individual `.bin` tracks,
`.m3u` playlists, and BIOS files never become games on their own. Matching
`.sbi` files are included with a disc when present. The game download API serves
a standalone file directly or a ZIP containing all required files and discs.

For optional IGDB metadata and cover art, set `IGDB_CLIENT_ID` and
`IGDB_CLIENT_SECRET` from a Twitch developer application before running
`npm run index:games`. The indexer stores matched metadata locally; the API
needs no IGDB credentials at runtime. IGDB matching requires both the title and
platform to agree, so use the platform's IGDB name for its folder when possible.
Common trailing ROM tags such as `(USA)`, `(En,Fr,Es)`, and `(Rev 1)` are
removed from the displayed title and IGDB search, while the indexed filename
and same-stem local cover lookup remain unchanged. Games that still lack cover
art are retried on the next `index:games` run when IGDB is configured.
Unmatched games keep their cleaned filename title and nullable metadata. A
`<game name>.game.json` file beside a game can override `title`, `platform`,
`release_year`, and `genre`; a `.jpg`, `.jpeg`, `.png`, or `.webp` file with the
same name stem beside the game is used as local cover art.

## Books

Store books below `Books/` in the configured archive root. Nested directories
are supported, including `Books/English/`. Files with the same case-sensitive
stem in the same directory form one book edition:

```text
Books/English/Frankenstein.epub
Books/English/Frankenstein.txt
Books/English/Frankenstein.book.json  # optional corrections
```

For just the books backend, run `npm run index:files` followed by
`npm run index:books`. The book indexer reads EPUB 2 and EPUB 3 metadata locally;
it makes no external metadata requests. It extracts titles, ordered contributors
and roles, languages, identifiers (including validated ISBNs and Gutenberg IDs),
subjects, description, publisher, dates, rights, series, layout, and cover art.
Other embedded metadata, including accessibility and source links, is preserved
in the detail response's `metadata.raw` array. `metadata.sources` records origins.

EPUB publication year and original publication year are separate. The original
year stays null unless explicitly supplied. A missing ISBN is normal, particularly
for Gutenberg books. Invalid declared ISBNs are retained as `invalid_isbn`
identifiers and are excluded from the convenience ISBN fields. Identifiers are
not globally unique: separate editions can share an ISBN or Gutenberg ID.

`page_count` is populated only from explicit metadata or a sidecar. Navigation
page markers are counted separately in `page_marker_count`; they do not establish
a complete page count. `word_count` is an approximate count from linear EPUB
body content, excluding scripts, styles, and navigation. It may be null if content
cannot be parsed within the read limits. Missing metadata remains null.

Covers are cached as separate SQLite blobs and served through `/books/:id/artwork`.
JPEG, PNG, GIF, and WebP covers are supported through EPUB 3 manifest properties
or EPUB 2 cover metadata. SVG covers currently produce a warning and no artwork.
Missing optional covers/navigation and failed word counts are reported in
`metadata.warnings`; they do not prevent bibliographic indexing. ZIP reads are
bounded to 20,000 entries, 8 MiB per XML member, 16 MiB per cover, and 64 MiB
of total decompressed content read. External XML entities are never resolved.

TXT-only books receive filename titles and can be downloaded. Recognized
Gutenberg TXT headers can fill missing titles, authors, supported language codes,
and Gutenberg IDs. `can_read` is true only for an EPUB whose metadata index state
is successful; it is a capability hint, not browser-reader or DRM validation.
The client Books page displays cover cards with reading and EPUB/TXT download
actions. It supports title/author/subject search, author/language/subject/format
filters, sorting, and paginated loading. Books also appear on Home, Search, and
Downloads. Open a Read action to use the EPUB viewer with chapter navigation,
page buttons/arrow keys, text size, and paper/sepia/night themes. Preferences and
revision-specific reading positions are saved in this browser. Printed page
counts remain distinct from the reader's responsive section page numbers.

The reader loads on demand and sanitizes chapters before rendering them in
sandboxed iframes. EPUB scripts, forms, external links, and remote resources are
disabled; packaged images and styles are supported. TXT-only books and EPUBs
with indexing errors can be downloaded but cannot be opened in the reader.
DRM-protected EPUBs are unsupported.

An optional same-stem `.book.json` file overrides embedded metadata. For example:

```json
{
  "title": "Frankenstein",
  "authors": ["Mary Shelley"],
  "original_publication_year": 1818,
  "page_count": 280,
  "languages": ["en"],
  "subjects": ["Gothic fiction"],
  "identifiers": [{ "scheme": "gutenberg", "value": "84" }]
}
```

Supported scalar overrides are `title`, `subtitle`, `sort_title`, `description`,
`publisher`, `publication_date`, `publication_year`, `original_publication_year`,
`series_name`, `series_position`, `page_count`, `page_count_source`,
`page_marker_count`, `word_count`, `rights`, `epub_version`, and `layout`.
Optional scalars accept null to clear a value; title must be nonempty. A page
count override automatically records `sidecar` as its source. Changing
`publication_date` also updates its derived year unless a year is explicitly supplied.

Array overrides replace their existing values, and empty arrays clear them.
`authors`, `subjects`, and `languages` accept strings. Use `contributors` instead
of `authors` for objects with `name`, `role` (for example `aut`, `trl`, `edt`,
or `ill`), optional `sort_name`, and optional `authority_id`. Identifier objects
use string `scheme` and `value` fields. Unknown keys, invalid values, and malformed
sidecars fail that source's refresh and preserve its previous successful metadata.

Successful unchanged sources skip EPUB parsing using format file size/mtime,
file IDs, sidecar contents, and parser version. Use `npm run index:books -- --force`
to rebuild all book metadata. Errors produce a nonzero exit status after other
books are processed, are stored in `book_index_state`, and are retried on the next
run. Failed updates retain earlier metadata and artwork. Book IDs remain stable
across retagging and adding/removing a format; renaming the source creates a new ID.
Run file indexing with `--prune` and then book indexing to reconcile deletions.
A book is removed only after all its format records are pruned. Missing/unreadable
archive folders are never treated as proof that the books were deleted.

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
the built client, with `/api` proxied to the local API. Preview binds to
`127.0.0.1` by default on Vite's default preview port, 4173, so it is available
on the machine running it. Music and games pages use indexed data.

## API

All endpoints are under /api/v1 and currently support GET and HEAD.

| Endpoint | Purpose |
| --- | --- |
| /health | Check server and database availability |
| /library/summary | File totals by category, music totals, game totals, and book totals |
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
| /books | Search and list books, with format, artwork, and reader URLs |
| /books/facets | Available authors, languages, subjects, and publication years |
| /books/:id | Complete book metadata, identifiers, provenance, and available formats |
| /books/:id/artwork | Cached raster cover; supports ETag conditional requests |
| /books/:id/content | Inline EPUB, including byte ranges |
| /books/:id/download | Preferred EPUB/TXT attachment; use `?format=epub` or `?format=txt` to select |

Lists accept limit (default 30, maximum 100) and offset. File filters are q,
category, extension, and path (a relative path prefix). Album filters are q,
artist_id, year, and genre. Track filters also accept album_id. Artist lists
accept q.
Game filters are q, platform, genre, and year.
Book filters are q, author, language, subject, year, and format. Book search matches
title, subtitle, description, contributor names, identifiers, and subjects.
The author/language/subject filters match exactly, ignoring case; author excludes
translator and editor credits. Book sort options are title (default), newest,
oldest, and added. Year sorts use EPUB publication year, with missing years last.
Book format values are `epub` and `txt`. A missing book or requested format returns
404; an invalid format/filter returns 400. Downloads without a format prefer EPUB,
then TXT. Book `gutenberg_id`, `isbn10`, and `isbn13` values are strings or null.

List responses contain data and pagination (limit, offset, total). Detail
responses contain data. Sizes are bytes, durations are milliseconds, and missing
music tags are null. File paths in JSON are relative to their archive category;
the API never accepts an arbitrary filesystem path for file delivery. Album
downloads stream a ZIP containing the indexed album folder, including sidecar
files such as cover images when present.

Search keeps substring matching. Common searches with at least three plain-text
characters use SQLite FTS5 to narrow candidates; short and punctuation-heavy
searches use the original substring query. Existing databases build these search
indexes once at the next server or indexer startup, so that first startup may
take longer for a large archive. The indexes stay synchronized as rows change.
Books gain metadata and contributor FTS indexes on the first upgraded startup.
File content supports a single byte range on GET. HEAD, unsupported range units,
and multipart range requests receive the complete file headers or content.

## Tests and search benchmark

Run `npm test` for the server and indexer suites. Tests create temporary media
and databases; they do not use the local archive. GitHub Actions runs the suite
on Windows and Ubuntu with Node.js 22 and 24.

Run `npm run benchmark:search` to compare substring scans with the FTS candidate
query on 50,000 synthetic in-memory rows. Pass a different row count with
`npm run benchmark:search -- 100000`. Results depend on the machine and query;
the benchmark does not access the archive database.
