---
name: Google Maps key API restrictions
description: Maps keys can permit Routes API while still blocking legacy APIs, and browser versus server restrictions must stay separate.
---

The original server Maps key returned `REQUEST_DENIED` / 403 "not activated" for legacy Directions and Maps Static APIs. Routes API v2 normally handles walking. When that same server key's API restrictions did not allow Routes, walking requests returned `PERMISSION_DENIED` / `API_KEY_SERVICE_BLOCKED` (403); a separate browser-restricted Maps JavaScript key does not authorize server-side Routes requests.

Google Places autocomplete currently falls back to local sample-area and VTA-stop results with the configured server key. Walking via Routes API and the browser-keyed Google 3D map are working.

**Why:** A live autocomplete request returned `source: "demo"` with the Places-unavailable message, while the coordinate-based walking route returned a live route and the 3D map endpoint rendered the Google map document.

**How to apply:** Keep the local autocomplete fallback. Keep Routes API enabled on the server key and Maps JavaScript API enabled on a distinct HTTP-referrer-restricted browser key. Do not assume Static Maps can render; avoid exposing a server key to the client.
