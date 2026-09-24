---
name: Orivis demo account scope
description: The product decision behind role-scoped report access in a shared-credential prototype.
---

For Orivis report workflows, retain the existing shared demo sign-in rather than silently switching to verified accounts. Demo role scoping is for prototype behavior only; it does not identify individual people or provide secure per-person ownership.

**Why:** When offered a choice between verified accounts and preserving demo sign-in for the web and mobile report-history update, the user explicitly chose demo sign-in after being told that shared credentials cannot provide real user isolation.

**How to apply:** Continue to label report access as prototype-only and do not represent shared demo identities as secure accounts. If a future request needs real cross-account privacy, raise the identity change explicitly rather than treating the demo session as sufficient.