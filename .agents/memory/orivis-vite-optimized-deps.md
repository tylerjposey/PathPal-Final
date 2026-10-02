---
name: Orivis Vite optimized dependency cache
description: Diagnose stale React version warnings in the Orivis web preview.
---

When the Orivis dev overlay reports mismatched React versions but pnpm resolves matching versions for the app, check the ignored `artifacts/orivis/node_modules/.vite/deps/_metadata.json` cache. Vite can continue serving an optimized bundle built from a previous dependency graph.

**Why:** The app's installed React and ReactDOM were both 19.2.3, while Vite's cached dependency metadata and browser overlay still reported 19.1.0. Clearing the generated cache and restarting the web workflow restored the sign-in page without changing dependencies.

**How to apply:** Stop the web workflow, remove only `artifacts/orivis/node_modules/.vite`, then restart it. Do this only when package resolution confirms the versions are already aligned.