---
name: 511 live feed shapes
description: Live 511 SF Bay transit JSON wrappers differ from some published specification examples.
---

The live 511 operator endpoint can return a bare array, while the older transit specification illustrates a `content` wrapper. The live service-alert endpoint returns GTFS-RT-style `Header` and `Entities`, not the SIRI `SituationExchangeDelivery` illustrated elsewhere in the specification.

**Why:** An initial implementation based only on the specification parsed zero operators and treated valid alert responses as incomplete, despite successful upstream requests.

**How to apply:** When updating 511 integration, allow both documented and observed wrappers, validate against non-secret response shapes, and do not present unparsed feeds as live alerts. Avoid logging full upstream responses or URLs because requests contain API credentials.