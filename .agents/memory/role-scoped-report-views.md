---
name: Role-scoped mobile state
description: Preventing cross-account mobile state leaks and stale shared-data views.
---

For any report view backed by persistent mobile state, authorize the visible rows against the *current* demo account's successful server list. Keep older device-only records isolated to their originating account; do not treat every server-absent row as a legacy report.

For family-shared server records, include the active account in client sync de-duplication keys. Clearing local state on account changes is not enough if an unchanged family/record marker causes the next account's load to be skipped.

**Why:** After a Citizen submitted a report, a Parent on the same device could still see it in a state-backed case queue even though the separate server-backed history correctly excluded it. Also, family journeys are shared across members while mobile storage is account-scoped; switching between two members of one family can clear the local route without changing the server journey identity.

**How to apply:** Derive report visibility from the active account's server result and scoped legacy bucket. When clearing account-local state, ensure family-shared records still rehydrate for the new account even if their family and record identifiers are unchanged. Test every state-backed surface on role and account switches.