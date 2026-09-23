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
Selecting **이 기기에서 30일 동안 기억하기** at PIN login keeps this browser signed in
for 30 days instead. The PIN is not stored: only the signed HttpOnly session cookie
persists. Clearing cookies, switching browsers, or choosing **편집 잠그기** requires
PIN login again.

Saved city data lives in the site-wide `trip-2026` Netlify Blobs store across
deploys. Other devices see it on refresh. Concurrent edits produce a conflict
instead of overwriting another save; copy your changes before cancelling and
loading the latest itinerary. Moving a card also moves its incoming transport;
review its route when changing the order.

Static HTML supplies the initial itinerary and offline fallback. Once a city
has shared saved data, edits to that city's static HTML do not replace it.
Preserve existing source card order/IDs in future template changes, or migrate
the stored data when changing the seed structure.

## Time planning

Each card supports a local start time, visit duration in minutes, fixed-time flag,
incoming travel time, travel buffer, mode, and routing address. Empty durations
or travel times remain unknown. Existing text is preserved until an explicit edit
or recalculation. Known legacy time ranges initialize durations; explicitly
matching reservation times and flight/train endpoints initialize fixed flags.
Review these defaults in the editor.

Day summaries and card badges show gaps and shortages. `시간 다시 계산` previews
changes before applying them; fixed times never move, and unknown values stop
reflow. Moving cards invalidates travel estimates tied to their previous origin.
Existing transport prose remains visible with an outdated-route warning when its
source order changes. Saving remains explicit and shared.

## Automatic transport setup

Enable Google Routes API in the owner's Google Cloud project with billing, then
set `GOOGLE_ROUTES_API_KEY` as a secret Netlify Functions environment variable and
redeploy. Restrict the key to Routes API and set provider quotas appropriate for
the owner's budget. No key means no provider calls or invented estimates.
No billing account or API key was created by this change.

The authenticated `/api/trip/routes` endpoint compares walking and transit,
uses the city's timezone for the trip date, includes initial waiting and final
walking, and prefers fewer transfers for transit. Requests are limited site-wide
to 60 per 15 minutes (up to two provider calls each). Raw provider responses are
not stored. Chosen travel estimates become editable planning values. Recheck
actual services on the day; predicted schedules are not guaranteed. See
`route-policy.html` for the public disclosure.

`교통 포함 자동 계산` queries each eligible leg in order and presents a preview;
missing locations/durations skip the relevant legs and failures preserve drafts.
The selected route is the fastest returned mode, with at least 5 minutes plus
3 minutes per transfer as a buffer. These buffers are editable planning defaults.
