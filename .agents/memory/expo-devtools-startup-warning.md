---
name: Expo DevTools startup warning
description: Handling the Linux debugger-shell error when Metro can still serve the Expo app.
---

Expo may report that React Native DevTools cannot start because its Linux debugger-shell cannot load `libglib-2.0.so.0`. This can happen while Metro starts and bundles successfully; the same warning has also appeared in a successful mobile deployment.

**Why:** The debugger-shell binary depends on a shared library that is absent from the current Linux environment. That warning is separate from Metro's bundle generation and is not, by itself, evidence that an Expo export failed.

**How to apply:** When debugging Expo publishing, check whether Metro reports `iOS Bundled` or `Android Bundled` and look for a later export error. Do not change app code or dependencies based on the DevTools warning alone.