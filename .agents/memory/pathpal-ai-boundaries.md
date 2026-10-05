---
name: PathPal AI boundaries
description: Product constraints for OpenAI assistance in PathPal.
---

Use AI only for child-facing guidance during an active simulated SOS chat and for scoring/summarizing a community report when it is submitted. Keep SOS transcripts out of report history, general notifications, and police-contact sharing. AI suggestions are not verified findings, and nothing can contact real emergency services.

**Why:** The product owner explicitly narrowed AI to these two flows; all roles, journeys, maps, and emergency actions remain a synthetic prototype.

**How to apply:** Keep model calls server-side, request only redacted minimum context, preserve safe non-AI fallbacks, and do not add AI to other app features or grant it authority over SOS state, permissions, reports, or dispatch.