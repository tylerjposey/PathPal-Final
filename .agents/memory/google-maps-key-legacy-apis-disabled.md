---
name: Google Maps key lacks legacy API access
description: This project's GOOGLE_MAPS_API_KEY only has newer Google Maps Platform APIs enabled, not the legacy ones.
---

The Google Maps key returns `REQUEST_DENIED` / 403 "not activated" for legacy Directions and Maps Static APIs. Routes API v2 is enabled for both walking and transit.

**Why:** Attempts to use the legacy APIs failed despite the key being configured.

**How to apply:**
**How to apply:** Use Routes API v2 for directions. Do not assume Static Maps can render; obtain suitable Google Maps API access separately or use a clearly labeled alternative without exposing a server key.
