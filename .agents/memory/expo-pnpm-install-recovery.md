---
name: Expo pnpm install recovery
description: Recover mobile dependency-resolution failures caused by a package-manager layout mismatch in the pnpm monorepo.
---

When Metro reports missing entrypoints across unrelated Expo and React Native packages, first suspect a damaged or mismatched `node_modules` layout. Do not add Expo or React as workspace-root dependencies to work around broken app links. Restore the workspace from its pnpm lockfile before changing application dependencies.

**Why:** The mobile app's pnpm links can point into `node_modules/.pnpm`, while a flat npm install leaves unrelated root packages and invalidates those links. In this state, Metro may report unrelated missing files at once. Rebuilding from the checked-in pnpm lock restored the app without source changes. Newly published Expo patches may also be temporarily blocked by the workspace's 24-hour minimum-release-age policy.

**How to apply:** Confirm the package manager and lockfile, remove only root-level install artifacts proven to be outside the pnpm dependency graph, and run `pnpm install --frozen-lockfile`. Retest Expo/Metro with the locked versions. Do not weaken the minimum-release-age policy just to silence patch-version warnings; defer those updates until the safeguard permits them.