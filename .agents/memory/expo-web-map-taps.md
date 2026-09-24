---
name: Expo web map taps
description: Cross-platform pointer event behavior for map-pin interactions in the Expo web preview.
---

Do not assume `locationX` and `locationY` exist on React Native Web `Pressable` events. For coordinate-based map interactions, use available web pointer coordinates relative to the element bounds and guard against non-finite values before persisting a pin.

**Why:** A real mobile-preview browser run returned `NaN, NaN` from a map tap even though native-event location coordinates were expected; the form was blocked until a web-compatible coordinate path was added.

**How to apply:** Exercise pin gestures in both native and Expo web previews when modifying location input, and validate finite coordinates before save.