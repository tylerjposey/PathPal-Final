---
name: React Native Alert.alert is a no-op on web
description: Confirmation dialogs using RN's Alert.alert silently do nothing in Expo web preview / react-native-web.
---

`Alert.alert(...)` from `react-native` compiles to react-native-web's `Alert` export, which is a literal no-op stub (`static alert() {}`, see `react-native-web/dist/exports/Alert/index.js`). Calling it on web produces no dialog, toast, or console output at all — not a Playwright dialog-suppression artifact.

**Why:** discovered while testing a check-in confirmation flow in Orivis Mobile: `Alert.alert('Check-in confirmed', ...)` fired after every milestone confirmation, but nothing appeared in the Expo web preview even with a Playwright `page.on('dialog', ...)` listener registered. The button state and underlying data updated correctly; only the confirmation feedback was invisible.

**How to apply:** on native (iOS/Android) `Alert.alert` works normally, so this is only a gap for the web preview target. If a confirmation needs to be visible on web, don't rely solely on `Alert.alert` — pair it with (or replace it with) an in-app toast/snackbar component, or check `Platform.OS === 'web'` and use `window.alert`/a custom banner there. When testing such flows with the Playwright testing subagent, don't expect a native dialog event; verify the resulting state/UI change instead.
