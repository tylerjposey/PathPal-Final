---
name: Orivis account deletion boundary
description: Confirmed scope for Delete Account while Orivis still uses shared demo identities.
---

Keep account deletion unavailable while Orivis uses shared demo sign-in. Do not clear local family data and describe it as deleting an account, and do not claim a child's access has been revoked.

**Why:** The user chose to build the Delete Account screen but defer deletion until real accounts exist. Shared demo credentials cannot provide reliable cross-device revocation.

**How to apply:** Keep the limitation explicit in UI until account-backed authentication can persist family membership and revoke every linked child session.