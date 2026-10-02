---
name: Bus route geometry
description: Product rule for drawing transit routes when provider geometry is incomplete.
---

Never draw a straight stop-to-stop connector as a bus route. Only display a provider-supplied route polyline or a segment sliced from an ordered operator shape. If exact geometry cannot be established, keep the stop markers and explain that the path is unavailable.

**Why:** A straight connector can look like the bus travels through buildings instead of following streets, making the planner materially misleading. Testing only route data can miss a renderer that invents a line.

**How to apply:** Preserve this rule across 2D and 3D journey maps and feed-specific geometry recovery. If 511 has no scheduled option, Google Transit may provide a fallback only when its agency data verifies VTA; use its step polylines and label it as Google directions, not a 511 schedule. If no verified provider path is available, omit the bus route rather than inventing one. Test rendered map behavior by running its generated script with a stub map-layer API and asserting no line layer is created for a bus leg without geometry; use a small tolerance for decoded coordinate comparisons.