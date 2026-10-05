---
name: Expo Metro watcher limits
description: Shared inotify exhaustion when multiple Metro servers run in the workspace.
---

Starting a second Metro server can fail with `ENOSPC: System limit for number of file watchers reached`, even when it uses a different port. Port conflicts and watcher exhaustion are separate problems: changing the port fixes only the former.

**Why:** Expo apps and component-preview workflows share the Linux workspace's inotify watcher quota; a persistent second server can exceed it while a one-shot bundle export still succeeds.

**How to apply:** When a Metro build fails with `ENOSPC`, avoid starting duplicate persistent bundlers. Prefer a one-shot bundle check or free the existing Metro workflow before another server starts.