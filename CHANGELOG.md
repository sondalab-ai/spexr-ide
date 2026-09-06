# Changelog

## 0.2.0 — 2026-09-06

> Five Dependabot alerts survived. Everything else changed.

### Features
- Watch every running [Claude Code](https://github.com/anthropics/claude-code) session on a mosaic wall, grouped by project, with expandable cards and embedded [terminal emulators](https://en.wikipedia.org/wiki/Terminal_emulator).
- Start sessions per account from the launcher, choosing which [CLAUDE_CONFIG_DIR](https://docs.claude.com/en/docs/claude-code/settings) a session runs under, with recents remembered.
- Harden the [Git](https://git-scm.com/) panel: per-file stage, unstage, discard with confirmation, [merge-conflict](https://git-scm.com/docs/git-merge) groups, and a branch indicator with ahead/behind.
- Support multiple [workspace folders](https://code.visualstudio.com/docs/editor/multi-root-workspaces) in the git view, because one repository per window was always a polite fiction.
- Write commit messages with the local model, fed the actual [diff](https://en.wikipedia.org/wiki/Diff) instead of a list of filenames.
- Make the search summary model configurable and run it on [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API), about four times faster, with a CPU fallback.
- Run [opencode](https://github.com/sst/opencode) beside Claude through a multi-harness adapter where each harness answers for itself whether it is installed.
- Force-complete a workflow step, persist it in the [front matter](https://jekyllrb.com/docs/front-matter/), and hand [lint](https://en.wikipedia.org/wiki/Lint_(software)) findings straight to the agent.
- Preview any [Markdown](https://daringfireball.net/projects/markdown/) file, not only the ones the editor previously felt like previewing.
- Read the Welcome page changelog from [GitHub](https://github.com) rather than the bundle, so releases stop shipping yesterday's news.
- Adopt the Sondalab [design tokens](https://en.wikipedia.org/wiki/Design_system) across [Theia](https://github.com/eclipse-theia/theia) chrome while keeping SPEXR's own product identity.

### Fixes
- Cap the Smart Search and Repositories sections at a quarter of the Explorer panel instead of letting them annex it.
- Relaunch the agent terminal when its process is gone, rather than presenting a dead [shell](https://en.wikipedia.org/wiki/Shell_(computing)) as a feature.
- Resolve the startup theme from what the last run actually painted, ending the recurring white flash.
- Keep the [file tree](https://en.wikipedia.org/wiki/Tree_view) from snapping back to the selected row every time you scroll away from it.
- Fork the search model into a real [Node](https://nodejs.org/api/child_process.html) child process and cap [ONNX Runtime](https://onnxruntime.ai/) threads so inference stops starving the backend.
- Shut the backend down when its parent dies, closing a long and productive career of orphaned processes.
- Send repository-relative paths to git, not absolute ones, and normalise the root once so trailing slashes stop mattering.

### Internals
- Upgrade [Theia](https://github.com/eclipse-theia/theia) to 1.75, [React](https://react.dev/) to 19 and [Electron](https://www.electronjs.org/) to 42, all in one sitting.
- Close 101 of 106 open [Dependabot](https://docs.github.com/en/code-security/dependabot) alerts; the remaining five are now considered personality.
- Drop the [webpack](https://webpack.js.org/) loaders left behind by the [esbuild](https://esbuild.github.io/) switch and stop tracking generated sources.


## 0.1.5 — 2026-07-02

> Smarter search, tighter security, lazier release notes

### Features

- Adds [semantic search](https://en.wikipedia.org/wiki/Semantic_search) with local-model embeddings, so the codebase finally understands intent, not just keywords.

### Fixes

- Fixes Git and Search panel visibility bugs surfaced while polishing the README, because docs and reality had drifted apart.
- Unifies default-view opening inside [`onDidInitializeLayout`](https://github.com/eclipse-theia/theia), and hardens the e2e tab-wait so flaky startup races stop failing [CI](https://en.wikipedia.org/wiki/Continuous_integration).
- Skips nested [`node_modules`](https://docs.npmjs.com/cli/v10/configuring-npm/folders) directories during incremental indexing, sparing Search from cataloguing the same dependency tree twice.
- Strips the redundant 'This file' prefix AI-generated descriptions kept insisting on, because yes, we already knew it was a file.
- Hardens [`shell.openExternal`](https://www.electronjs.org/docs/latest/api/shell#shellopenexternalurl-options) calls by building the release URL locally instead of trusting external input.

### Internals

- Automates release notes generation by syncing straight from the [changelog](https://keepachangelog.com/en/1.0.0/), because manual copy-paste was nobody's favorite Friday task.

## 0.1.3 — 2026-06-21

> Updates that actually tell you about updates.

### Fixes

- **Update check** — replaced `electron-updater` (requires Apple Developer cert) with a direct GitHub API check; shows a dialog with a download link when a newer version is available. Works on unsigned builds across all platforms.
- **Security** — release URL constructed locally from the validated version tag, never sourced from the GitHub API response.

## 0.1.2 — 2026-06-20

> Small things that were bothering everyone.

### Fixes

- **Responsive sidebar lists** — experts and memory panels wrap at ≤320 px via CSS container queries: description goes full-width, action buttons move below.
- **What's new spacing** — added top margin to the What's new panel for visual separation from the workflow section above.
- **Local settings untracked** — `.spexr/settings.json` removed from version control (contains machine-specific paths); `settings.example.json` added as onboarding template.

## 0.1.1 — 2026-06-17

> The one where we learned what version we are.

### Features

- **About dialog** — version and build info accessible from the menu.

### Fixes

- **Startup UX** — improved loading sequence and initial state on workspace open.
- **Preview focus** — fixed focus steal on markdown preview open.

## 0.1.0 — 2026-06-14

> The one where we finally commit.

### Features

- **Spec workflow** — `docs/specs/<NNNN-slug>.md` files move through a 7-step stepper (Specify → Context → Clarify → Plan → Implement → Validate → Ship).
- **Agent-primary shell** — Claude Code session starts automatically on workspace open; the terminal is the primary surface.
- **Expert personas** — built-in catalog (brainstorming, design, review, marketing, DRI, software-engineering); each auto-activates on the matching workflow step. Installed as `docs/agents/<id>.md`.
- **Spec context fan-in** — files and links attached to a spec are passed to the agent automatically on handoff.
- **Plan & task artifacts** — the Plan step produces `_plan.md` with a checklist linked to acceptance criteria; checkboxes are tickable from the UI.
- **Drift detector** — runs the agent against the spec's acceptance criteria and linked source files; surfaces block/warn/info findings; persists `_drift.json`.
- **Ship to PR** — one action commits staged work with a `Spec: <slug>` trailer, pushes, and opens a GitHub PR.
- **Live spec validation** — bottom panel lints the active spec on every keystroke (duplicate AC ids, placeholder text, frontmatter errors); count badge on collapsed tab.
- **Markdown preview** — split-right preview of the active spec, debounced live re-render, toolbar toggle.
- **Two-scope memory** — `~/.spexr/memory/` (user) + `<workspace>/docs/memory/` (project).
- **Workspace progress bar** — aggregate completion percentage across all specs in the panel.
