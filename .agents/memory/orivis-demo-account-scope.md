---
name: Orivis demo auth scope
description: The boundary between real Clerk accounts and development-only PathPal demo sign-in.
---

Keep Clerk email/Google for real PathPal accounts. Username and phone sign-in are shared demo flows available only in development; phone verification is simulated and must never imply that an SMS was sent. Demo sign-in opens the Parent preview without a role selector. Do not collect phone numbers during Child signup or account setup; real Child accounts continue through Clerk email verification and a family invitation code.

**Why:** The user chose to keep Clerk for real accounts and accepted that username/phone behavior is demo-only. Managed Clerk does not support SMS/phone sign-in, and shared demo credentials cannot provide real user isolation.

**How to apply:** Keep demo endpoints disabled outside development, label verification as simulated, and preserve real email/Google sign-in. Do not migrate auth providers or add real SMS delivery unless the user changes this scope.