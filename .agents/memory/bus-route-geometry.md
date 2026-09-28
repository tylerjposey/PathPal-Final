---
name: Bus route geometry
description: Product rule for drawing transit routes when provider geometry is incomplete.
---

Never draw a straight stop-to-stop connector as a bus route. Only display a provider-supplied route polyline or a segment sliced from an ordered operator shape. If exact geometry cannot be established, keep the stop markers and explain that the path is unavailable.

**Why:** A straight connector can look like the bus travels through buildings instead of following streets, making the planner materially misleading.

**How to apply:** Preserve this rule across 2D and 3D journey maps and any feed-specific geometry recovery. Recover paths only from the operator's ordered shape; omit a line when stops cannot be safely matched.