---
name: Orivis demo account scope
description: The product decision behind role-scoped report access in a shared-credential prototype.
---

For Orivis report workflows, retain the shared AI4SG demo sign-in rather than silently switching to verified accounts. Keep demo access development-only and separate from real Clerk accounts. Demo role scoping is for prototype behavior only; it does not identify individual people or provide secure per-person ownership. Phone numbers may be collected as private contact details, but must not be presented as verified sign-in credentials unless the user explicitly chooses a phone-capable identity provider.

**Why:** The user asked to restore the shared demo while keeping real Clerk accounts separate and did not request an identity-provider change. Managed Clerk does not support SMS/phone sign-in, and shared demo credentials cannot provide real user isolation.

**How to apply:** Continue to label report access as prototype-only and do not represent shared demo identities as secure accounts. Preserve the four demo roles (Parent, Child, Case Manager, Worker) without adding Citizen. Keep real accounts on Clerk email/Google sign-in; evaluate an alternate identity provider only after the user asks for verified phone sign-in.