# Schedule and transport implementation plan

Goal: let the traveler change visit duration, see spare/insufficient time, and explicitly recalculate schedules without moving reservations.
Architecture: optional schedule fields on schema-1 cards for backwards compatibility; pure schedule calculation module; shared editor integration; authenticated route lookup only if the owner configures a provider.

Ruling: proceed inline without repeated design approvals, following the user's standing no-intermediate-questions instruction and explicit request to implement the discussed behavior. External billing/API access still needs owner setup.

1. Write failing schedule tests: legacy ranges, missing durations, fixed appointments and propagated lateness, free gaps, midnight, changed predecessor route invalidation, Helsinki lanes.
2. Implement assets/schedule.js normalize/analyze/reflow/validate and enforce optional schedule fields on server. Preserve original rich time display until explicit recalculation/edit.
3. Add start, duration, fixed-time, incoming travel, buffer, mode and place fields. Render per-card diagnostics and per-day summaries. Add preview/apply recalculation; keep cancel/save semantics.
4. Provider integration depends on owner's answer; no paid API or billing enrollment without it. Missing routes remain unknown, never zero. Reordered route text is marked outdated; generate fresh route links from current adjacent places.
5. Test model/API and mobile UI, review, commit/push main and verify Netlify and existing saved data survive. Never overwrite live travel edits for tests.

Review focus: no silent time shifts on load; fixed times remain unchanged; unknown values never imply feasibility; old saves remain valid; route pair invalidation; server rejects invalid numeric fields; no API keys in static output.

Verification: model/API suite 31 tests passing; browser verified duration edit → end/shortage, fixed-preserving preview, apply/save, place-change invalidation, missing API-key error, and 390px layout.
Final review: independent reviewer found unknown-arrival reset at fixed booking and stale destination duration; both fixed. Regression test for uncertainty RED→GREEN, UI confirmed place change clears duration.
External prerequisite: Google Routes API key and billing selection remains pending owner response. All paid provider calls remain disabled without the key.
