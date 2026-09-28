---
name: Google Maps key API restrictions
description: Places, Routes, live VTA transit, and browser-keyed 3D maps work; preserve Google-only journey search and coordinate-gated routing.
---

As of 2026-09-27, the server Maps key supports Places API (New), Places Details, and Routes API v2. Live checks confirmed prediction lookup, coordinate resolution, walking routes, and VTA transit journeys. A separate browser-restricted Maps JavaScript key successfully serves the Google 3D map and must not be used for server-side Places or Routes calls. Legacy Directions and Static Maps APIs are unavailable on the server key.

The journey planner must not substitute local sample places or 511 stops when Google Places fails.

**Why:** The user requires Google Places as the only autocomplete source; this configuration was verified with live Google predictions and details, followed by coordinate-backed walking and transit routes.

**How to apply:** Use Places Autocomplete (New) for suggestions, then resolve coordinates through Places Details. If either call fails, return a clear error/503 rather than sample or 511 suggestions. Call 511 only for coordinate-backed transit route searches after an explicit user request; keep the browser key separate and never expose server keys to the client. If Places returns 403 again, check Google API enablement and key restrictions.
