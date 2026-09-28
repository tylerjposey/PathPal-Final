---
name: Google Maps key API restrictions
description: Maps keys can permit Routes API while still blocking legacy APIs, and browser versus server restrictions must stay separate.
---

The original server Maps key returned `REQUEST_DENIED` / 403 "not activated" for legacy Directions and Maps Static APIs. Routes API v2 normally handles walking. When that same server key's API restrictions did not allow Routes, walking requests returned `PERMISSION_DENIED` / `API_KEY_SERVICE_BLOCKED` (403); a separate browser-restricted Maps JavaScript key does not authorize server-side Routes requests.

**Why:** Attempts to use legacy APIs failed despite the key being configured, and Maps JavaScript setup coincided with the server key temporarily blocking Routes.

**How to apply:** Keep Routes API enabled on the server key and Maps JavaScript API enabled on a distinct HTTP-referrer-restricted browser key. Do not assume Static Maps can render; avoid exposing a server key to the client.
