---
name: Orivis demo account scope
description: The product decision behind role-scoped report access in a shared-credential prototype.
---

For Orivis report workflows, retain the existing shared demo sign-in rather than silently switching to verified accounts. Demo role scoping is for prototype behavior only; it does not identify individual people or provide secure per-person ownership.

For family invitations, store family records, globally unique invitation codes, and child membership centrally so a child can join from another device. Keep the shared demo sign-in; do not represent it as private per-person ownership.

**Why:** The user chose shared backend codes rather than device-local codes, while explicitly retaining shared demo sign-ins. Shared credentials still cannot provide real user isolation.

**How to apply:** Keep report access and family ownership labeled as prototype behavior. If a future request needs real cross-account privacy or secure child accounts, raise the identity change explicitly rather than treating the demo session as sufficient.