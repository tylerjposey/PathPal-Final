---
name: Role-scoped report views
description: Preventing cross-role report leaks from local state in a shared-device demo.
---

For any report view backed by persistent mobile state, authorize the visible rows against the *current* demo account's successful server list. Keep older device-only records isolated to their originating account; do not treat every server-absent row as a legacy report.

**Why:** After a Citizen submitted a report, a Parent on the same device could still see it in a state-backed case queue even though the separate server-backed history correctly excluded it. Clearing and partitioning cached state alone did not reliably prevent the leak; a render-boundary gate using the current account's authorized report IDs was needed.

**How to apply:** When adding a dashboard, map, task queue, case detail, or local migration path, derive report visibility from the active account's server result and scoped legacy bucket. On role switches, test both direct server-backed history and every state-backed surface; do not assume a protected API automatically protects local displays.