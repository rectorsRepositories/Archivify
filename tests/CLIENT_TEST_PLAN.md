# Books client checks

Run `npm test` and `npm run build` from the repository root. Reader state tests
use `node:test` and an isolated Storage-compatible fixture; they cover revision
identity, malformed/blocked storage, validated preferences, and safe bounded
chapter navigation. API/download/indexer behavior is covered by the book server
tests.

For browser checks, start `npm run dev` with a temporary `ARCHIVE_DB` and
`ARCHIVE_ROOT`. Copy available local EPUB/TXT pairs into that temporary archive,
then run file/book indexing. Never modify the personal archive for these checks.
Include a TXT-only edition, an invalid EPUB, and a synthetic EPUB with scripts,
event attributes, an iframe, a form, remote images/links, and an internal link.

1. Open Books at desktop and mobile widths. Verify covers/placeholders, titles,
   authors, both actions, disabled Read states, and no horizontal overflow.
2. Search titles and authors; combine author/language/subject/format filters,
   change sort order, reload URL filters, and clear a search with no matches.
   For more than 24 books, load the next page and verify no duplicates.
3. Select each available download format. Check attachment filename and format.
4. Open a real EPUB. Choose a chapter, turn pages with buttons and arrow keys
   (including when focus is inside the book), and resize the viewport.
5. Change text size and all themes. Reload and verify preferences and reading
   position; use restart and verify it returns to the beginning. Replacing the
   EPUB should invalidate its old position.
6. Navigate repeatedly between the reader and library. Check the console for
   application errors and ensure only the active reader remains mounted.
7. Verify Home totals/shelf, global book search, and the Downloads book section.
8. Open missing/nonreadable books and simulate API/EPUB failures. Verify useful
   error, retry, back, and download actions. Block local storage and confirm the
   book remains readable with an accurate persistence status.
9. Open the safety EPUB. Confirm scripts/event attributes/frames/forms are
   removed, external link targets are removed, the internal link works, and
   remote images fail with CSP. The iframe must omit `allow-scripts`.

Screenshots and other local browser artifacts belong in ignored
`output/playwright/` (CLI snapshots/downloads in `.playwright-cli/`).
