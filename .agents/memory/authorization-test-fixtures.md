---
name: Persistent authorization-test fixtures
description: Keep authorization tests deterministic when their development database persists across runs.
---

Authorization tests that need particular report properties, such as a stored photo or assigned team, must select rows created by the current test run rather than an unordered account-wide match.

**Why:** The development database persists between test runs, so `limit(1)` can return an older matching report without the photo or state the test expects, creating a misleading access-control failure.

**How to apply:** Track fixture IDs returned by test setup, constrain follow-up queries to those IDs, and clean up only those fixtures after the suite.