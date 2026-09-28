---
name: Expo DevTools startup warning
description: Handling the Linux debugger-shell error when Metro can still serve the Expo app.
---

Expo may report that React Native DevTools cannot start because its Linux debugger-shell cannot load `libglib-2.0.so.0`. This can happen even while Metro starts and the web app bundles successfully.

**Why:** The debugger-shell binary depends on a shared library that is absent from the current Linux environment; the app preview itself can still work.

**How to apply:** Treat this as separate from a JavaScript or Metro bundling failure. Confirm Metro reports a successful web bundle and the preview loads before changing app code or dependencies.