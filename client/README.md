# Archive client

A responsive Vite and React client for the local archive API. Home, Music, Games, and Books use indexed data.

## Run

From the repository root:

```sh
npm install
npm run dev
```

Open the address printed by Vite (normally `http://127.0.0.1:5173/`). This command starts the API if needed and proxies `/api` requests to it. Use `npm start` to run the API by itself. Use `npm run build` for a production build in `client/dist`, then `npm run preview` to serve that build with the API.

## Pages

- `/` — indexed file, music, game, and book totals with collection shelves
- `/music` — searchable, filterable indexed album library
- `/music/albums/:id` — album details, artwork, track downloads, and a ZIP of the album folder
- `/games` — searchable, filterable indexed game library with file downloads
- `/books` — book covers, title/author search, author/language/subject/format filters, sorting, and EPUB/TXT downloads
- `/books/:id/read` — EPUB reader with chapters, previous/next pages, arrow keys, text sizes, and paper/sepia/night themes
- `/search` — search albums, games, books, and files together
- `/downloads` — download albums, games, and preferred book editions

Music artwork and audio come from the API. Starting an album or track opens a player that continues across pages, with play/pause, previous/next, and volume controls. You can add individual tracks or whole albums to its queue. Browsers may not support every indexed audio format; individual tracks can still be downloaded. Game cover art comes from matching local images or IGDB when configured during indexing.

Download album retrieves a ZIP that extracts to one folder, preserving the album's indexed files and subfolders.

## Reading books

Index books using `npm run index:files` followed by `npm run index:books`. Book cards offer a format selector when both EPUB and TXT exist. TXT-only books and EPUBs with indexing errors remain downloadable; their Read button is disabled. Missing covers use a title placeholder.

The reader loads EPUB.js and its sanitizer on demand. Chapters render in a sandboxed iframe with scripts, forms, external links, and remote resources disabled. Local images and styles remain available. DRM-protected EPUBs are unsupported; a rendering failure offers retry and download actions.

Preferences and reading positions are saved in this browser's local storage. Progress belongs to the book ID and EPUB file revision, so replacing an EPUB starts a new position. It does not sync across devices. Reading continues when storage is disabled or full, and the footer reports that the position could not be saved. Page numbers describe the current section at the current viewport/text size, rather than the book's printed page count.

Reader state tests use the repository's Node test runner (`npm test`). Browser checks cover real local EPUBs plus temporary safety and availability fixtures; see `tests/CLIENT_TEST_PLAN.md`.

## Artwork prompts

The 12 local WebP covers were cropped from two contact sheets generated with the built-in image generation tool. The prompts were:

> Use case: stylized-concept. Asset type: a 3-column by 2-row contact sheet of SIX separate square album-cover illustrations for a self-hosted music archive UI. Make the grid mathematically even, edge-to-edge, no gutters, no borders, each panel a distinct complete square artwork. Top left: glowing amber sun over a desert horizon, dreamy synthwave. Top middle: luminous violet flower against deep charcoal. Top right: solitary woman portrait in teal and rust cinematic side light. Bottom left: northern forest under green aurora. Bottom middle: geometric brass prism floating over black. Bottom right: misty dark coastline in muted copper twilight. Cohesive premium editorial cover art, painterly photographic realism, rich texture, moody dark palette with warm amber highlights. NO words, typography, logos, watermarks, UI, or frames.

> Use case: stylized-concept. Asset type: a 3-column by 2-row contact sheet of SIX separate square game-cover illustrations for a self-hosted game archive UI. Make the grid mathematically even, edge-to-edge, no gutters, no borders, each panel a distinct complete square artwork. Top left: lone cloaked warrior before a giant glowing golden ring in a ruined valley. Top middle: science-fiction pilot silhouetted against a burning rust orange planet. Top right: neon magenta and orange motorcycle racing through rainy future city. Bottom left: dark medieval castle under eclipse. Bottom middle: deep-space astronaut amid turquoise crystalline asteroids. Bottom right: adventurous traveler before a sunlit ancient mountain temple. Cohesive cinematic game key art, striking silhouettes, dark charcoal shadows, copper and amber light, detailed atmospheric painting. NO words, typography, logos, watermarks, UI, or frames.
