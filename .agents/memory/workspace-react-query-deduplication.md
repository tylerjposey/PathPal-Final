---
name: Workspace React Query deduplication
description: Preventing production-only context failures when web apps consume workspace-linked generated React Query hooks.
---

Web artifacts that import generated hooks from a workspace-linked package must deduplicate `@tanstack/react-query` in Vite alongside React and React DOM.

**Why:** A production bundle can otherwise include separate React Query module instances even when pnpm reports the same package version. The app's provider then belongs to one instance while generated hooks read the other, causing an authenticated screen to fail with `No QueryClient set`.

**How to apply:** Keep React Query in Vite's `resolve.dedupe` list for web artifacts using the shared generated hooks. Verify a production bundle through an authenticated screen rather than relying only on build success or the unauthenticated landing page.