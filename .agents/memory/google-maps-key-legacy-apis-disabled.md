---
name: Google Maps key API restrictions
description: Routes and browser-keyed 3D maps work, but the current server key is blocked from Places Autocomplete; preserve the Google-only journey search.
---

As of 2026-09-27, the server Maps key supports Routes API v2, but Google Places Autocomplete (New) returns HTTP 403. A separate browser-restricted Maps JavaScript key successfully serves the Google 3D map and must not be used for server-side Places or Routes calls. Legacy Directions and Static Maps APIs are also unavailable on the server key.

Walking directions through Routes API, the browser-keyed Google 3D map, and live VTA transit requests are working. The journey planner must not substitute local sample places or 511 stops when Google Places fails.

**Why:** The user requires Google Places as the only autocomplete source; a live check returned 403 from Places while coordinate-backed walking and transit requests returned live routes.

**How to apply:** Use Places Autocomplete (New) for suggestions, then resolve coordinates through Places Details. If either call fails, return a clear error/503 rather than sample or 511 suggestions. Call 511 only for coordinate-backed transit route searches after an explicit user request; keep the browser key separate and never expose server keys to the client.
