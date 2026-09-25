# Archive client

A responsive Vite and React preview for the local archive server. All current library content is mock data; no backend connection, streaming, downloads, or general file manager is implemented yet.

## Run

```sh
cd client
npm install
npm run dev
```

Open the address printed by Vite (normally `http://localhost:5173/`). Use `npm run build` for a production build.

## Pages

- `/` — dashboard with storage overview and recent additions
- `/music` — searchable, filterable album library
- `/music/albums/:id` — album detail and track listing
- `/games` — searchable, filterable games shelf

Artwork is stored in `public/art`. The mock content lives in `src/data`; future fetch helpers live in `src/api` and are not connected to the preview UI.

## Artwork prompts

The 12 local WebP covers were cropped from two contact sheets generated with the built-in image generation tool. The prompts were:

> Use case: stylized-concept. Asset type: a 3-column by 2-row contact sheet of SIX separate square album-cover illustrations for a self-hosted music archive UI. Make the grid mathematically even, edge-to-edge, no gutters, no borders, each panel a distinct complete square artwork. Top left: glowing amber sun over a desert horizon, dreamy synthwave. Top middle: luminous violet flower against deep charcoal. Top right: solitary woman portrait in teal and rust cinematic side light. Bottom left: northern forest under green aurora. Bottom middle: geometric brass prism floating over black. Bottom right: misty dark coastline in muted copper twilight. Cohesive premium editorial cover art, painterly photographic realism, rich texture, moody dark palette with warm amber highlights. NO words, typography, logos, watermarks, UI, or frames.

> Use case: stylized-concept. Asset type: a 3-column by 2-row contact sheet of SIX separate square game-cover illustrations for a self-hosted game archive UI. Make the grid mathematically even, edge-to-edge, no gutters, no borders, each panel a distinct complete square artwork. Top left: lone cloaked warrior before a giant glowing golden ring in a ruined valley. Top middle: science-fiction pilot silhouetted against a burning rust orange planet. Top right: neon magenta and orange motorcycle racing through rainy future city. Bottom left: dark medieval castle under eclipse. Bottom middle: deep-space astronaut amid turquoise crystalline asteroids. Bottom right: adventurous traveler before a sunlit ancient mountain temple. Cohesive cinematic game key art, striking silhouettes, dark charcoal shadows, copper and amber light, detailed atmospheric painting. NO words, typography, logos, watermarks, UI, or frames.
