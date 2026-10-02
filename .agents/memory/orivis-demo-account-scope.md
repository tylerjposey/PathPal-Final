---
name: Orivis demo account scope
description: The product decision behind role-scoped report access in a shared-credential prototype.
---

For Orivis report workflows, retain the existing shared demo sign-in rather than silently switching to verified accounts. Demo role scoping is for prototype behavior only; it does not identify individual people or provide secure per-person ownership.

For family invitations, store family records, globally unique invitation codes, and child membership centrally so a child can join from another device. Central persistence does not make the shared demo identity private.

**Why:** The user kept shared demo access for existing report features but requested real, distinct parent and child identities for optional trip sharing. Shared credentials cannot provide per-person consent or privacy.

**How to apply:** Keep report access prototype-scoped. For live journey sharing, follow the separate-identity boundary documented in `replit.md`; never authorize private tracking from a demo session or report token.