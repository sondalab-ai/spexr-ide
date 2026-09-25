---
name: spexr-never-pkill-processes-by-worktree-path-a-user-launched
description: Never kill processes by a worktree's path: a SPEXR instance the user launched may be running from that worktree. Local Electron E2E cannot launch in the agent sandbox; rely on GitHub CI.
metadata:
  type: feedback
---

Never `pkill -f <worktree path>` to clean up after a test run. On 2026-09-25 the user had a SPEXR instance running from `.claude/worktrees/feat-ui-kit-glass-effects`; a cleanup keyed on that path killed its GPU, renderer and plugin-host helpers, and the user had to restart SPEXR. Kill only PIDs you started, recorded when you start them.

**Why:** a worktree is not owned by one process tree. The user, a peer session or an earlier run may have an app open from it, and its helpers match the same path.

**How to apply:**
- In the agent sandbox, `playwright test` cannot launch Electron (`electron.launch: Target page, context or browser has been closed`, `kill EPERM`). Local E2E failures there mean nothing; push and read the GitHub E2E run instead.
- Never run several E2E suites at once on the dev machine. See [[never-run-full-pnpm-test-or-the-full-e2e-suite-unthrottled-i]].
