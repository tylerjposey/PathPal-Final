---
name: Orivis demo account scope
description: The product decision behind role-scoped report access in a shared-credential prototype.
---

For Orivis report workflows, retain the existing shared demo sign-in rather than silently switching to verified accounts. Demo role scoping is for prototype behavior only; it does not identify individual people or provide secure per-person ownership.

For family invitations, store family records, globally unique invitation codes, and child membership centrally so a child can join from another device. Central persistence does not make the shared demo identity private.

For live journey sharing, use the existing PathPal parent/child sign-in and never introduce a separate tracking login. The parent enables the feature in More; the child opts in for each current journey from Home. Keep the explicit per-trip consent even though the prototype roles are shared.

The active PathPal role set is parent, child, manager, and worker. Do not reintroduce citizen as a selectable or authorized role. Keep older citizen-owned report rows as historical data rather than deleting or rewriting them.

During parent family creation, first name, last name, email, and phone are prototype-only profile fields; do not send them to email or SMS providers.

Children who join with a family code must remain pending until a parent approves them. Do not expose family details, reports, or tracking to pending child requests through direct API calls. Parent-created and existing child rows stay approved to preserve current demo behavior; the shared generic child session is blocked while requests are pending because it cannot identify which child is signing in.

**Why:** The user clarified that live journey sharing must use the app's existing sign-in rather than adding another sign-in option, removed citizen from the active role set while preserving historical reports, specified that parent contact fields are not connected to messaging providers, and requires parent approval before a family-code child can access family data. Shared demo roles remain a prototype and do not identify individual people.

**How to apply:** Reuse existing report-session claims and family records for role scoping. Require explicit parent approval for family-code joins and enforce it in every server path that exposes family data; preserve the parent's family-level tracking enablement and the child's separate opt-in for each journey. Treat citizen-owned records and saved citizen sessions as legacy only, keep parent email/phone local to the prototype profile, and do not treat demo sign-in as verified personal identity.