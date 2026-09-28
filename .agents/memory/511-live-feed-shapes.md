---
name: 511 live feed shapes
description: Live 511 SF Bay transit JSON wrappers differ from some published specification examples.
---

The live 511 operator endpoint can return a bare array, while the older transit specification illustrates a `content` wrapper. The live service-alert endpoint returns GTFS-RT-style `Header` and `Entities`, not the SIRI `SituationExchangeDelivery` illustrated elsewhere in the specification.

The VTA patterns endpoint rejects requests with identity encoding (HTTP 406); request `Accept-Encoding: gzip` or `deflate` and decompress the response. The VTA bulk GTFS ZIP is an alternative source of ordered trips, stop times, calendars, and bus shapes when constructing actual itineraries. The stop timetable endpoint returned HTTP 412 for a queried stop, so don't assume it is a usable source of next-trip data without validating its parameters against live responses.

**Why:** The documented response wrappers and compression behavior did not match actual provider behavior. A stop timetable request also failed despite the stop appearing in the provider's stop feed.

**How to apply:** When updating 511 integration, allow both documented and observed wrappers, send a supported Accept-Encoding for NeTEx endpoints, validate against non-secret response shapes, and do not present unparsed feeds as live alerts. Avoid logging full upstream responses or URLs because requests contain API credentials.