# Europe Trip 2026

Mobile travel hub with shared itinerary editing for five cities.

## Development

Run `npm ci`, `npm run build`, `npm test`, then `npm run dev`.
The local preview at `http://127.0.0.1:8787` uses in-memory data and test PIN
`3141592653`; restarting it clears local edits.

## Deployment

Netlify uses `netlify.toml`: `npm run build`, publish directory `dist`, and
Functions in `netlify/functions`. The build regenerates `netlify/data/seeds.json`
from the city HTML files. Only public assets are copied into `dist`.

Set secret environment variables `TRIP_EDIT_PIN` (at least 10 digits) and
`TRIP_SESSION_SECRET` (at least 32 random characters), available to Functions,
then deploy. Never put production values in the repository. Without them,
public viewing works but editing fails closed.

## Shared editing

Choose **일정 편집**, enter the PIN, edit cards, then choose **저장**. Drag the
handle or use arrows to reorder; the card form also supports dates, new cards,
deletion, and transport details. **취소** discards unsaved edits. **편집 잠그기**
ends this browser's editing session; sessions otherwise expire after 12 hours.

Saved city data lives in the site-wide `trip-2026` Netlify Blobs store across
deploys. Other devices see it on refresh. Concurrent edits produce a conflict
instead of overwriting another save; copy your changes before cancelling and
loading the latest itinerary. Moving a card also moves its incoming transport;
review its route when changing the order.

Static HTML supplies the initial itinerary and offline fallback. Once a city
has shared saved data, edits to that city's static HTML do not replace it.
Preserve existing source card order/IDs in future template changes, or migrate
the stored data when changing the seed structure.
