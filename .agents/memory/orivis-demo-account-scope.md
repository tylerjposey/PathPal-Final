---
name: Orivis demo auth scope
description: The boundary between real Clerk accounts and development-only PathPal demo sign-in.
---

Keep Clerk email/Google for real PathPal accounts. Username and phone sign-in are shared demo flows available only in development; phone verification is simulated and must never imply that an SMS was sent. Demo sign-in offers Parent, Child, Case Manager, and City Worker roles; the selected role applies to the shared prototype session, not a real account identity. Do not collect phone numbers during Child signup or account setup; real Child accounts continue through Clerk email verification and a family invitation code.

**Why:** The user chose to keep Clerk for real accounts, accepted that username/phone behavior is demo-only, and explicitly requested all four demo-role choices. Managed Clerk does not support SMS/phone sign-in, and shared demo credentials cannot provide real user isolation.

**How to apply:** Keep demo endpoints disabled outside development, show all four role choices only in the demo flow, label phone verification as simulated, and preserve real email/Google sign-in. Do not migrate auth providers or add real SMS delivery unless the user changes this scope.