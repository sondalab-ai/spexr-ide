---
name: prefer-node-test
description: Use node:test and node:assert, not a test framework.
type: feedback
---

**Why:** the owner wants zero dev dependencies for a tool this small.
**How to apply:** new tests go next to the file, named `*.test.ts`.
