# Shared itinerary editing

## Design

Keep the five existing city pages and Helsinki A/B views. Add one shared editor,
PIN-authenticated Netlify Functions and a site-wide strongly consistent Blobs store.
Everyone can read; writes require a short-lived HttpOnly session obtained by
server-side PIN verification. Secrets live in Netlify environment variables only.
The homepage and current visual design stay intact.

Cards have stable IDs, typed text fields, optional transport and options. The
initial static DOM is the rendering template, preserving original formatted text
when a field has not changed. Server input accepts text and HTTP(S) links only,
never arbitrary HTML. Newly added cards use the same design.

Saving is explicit and city-scoped. A revision conflict prevents a stale editor
from silently overwriting a newer save. Failure preserves the unsaved draft.
Drag handles plus up/down buttons work on phones and keyboards. A form supports
time, title, notes, category, map link, transport, date/option lane and deletion.
Helsinki's selected A/B option is shared when saved; both alternatives remain.

## Implementation plan

1. Extract all current timeline cards, preceding transport and choice groups into
   seed data. Verify text/URL coverage and retain static pages as offline fallback.
2. Implement tested validation, PIN sessions, rate limiting, strongly consistent
   reads and conditional writes. Fail closed when PIN configuration is missing.
3. Add edit toolbar, accessible dialogs, ordering, lane moves, add/delete,
   cancel/save, conflict and network error states. Preserve the current styling.
4. Build a static publish directory containing only public assets; bundle Functions
   separately. Test server APIs and the interface at phone/desktop widths.
5. Configure Netlify secrets, commit/push, then verify live unauthenticated read,
   authenticated save and a fresh independent browser read. Restore any test edits.

## Review focus

- Unauthorized/invalid PIN writes, cookie expiry, CSRF, public secret exposure.
- Simultaneous saves and stale revisions, first-save races.
- A/B alternatives and choice cards survive editing and reload.
- Failed loads/saves never replace good data with an empty draft.
- Touch dragging, cancel, deletion, day moves, and long or hostile text.

## Rulings

- Continue without intermediate design questions as requested earlier in this task.
- Generate a random 10-digit editing PIN and configure it only on the server;
  Netlify login is required and has been requested while implementation continues.
