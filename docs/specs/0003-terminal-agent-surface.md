---
slug: 0003-terminal-agent-surface
title: Embedded Claude TUI terminal as the agent surface
status: shipped
createdAt: 2026-05-22
relatedSpecs: 
workflowStep: ship
updatedAt: 2026-07-15
---
## Goal

Replace the headless SDK proxy with the real interactive `claude` CLI hosted inside an embedded Theia terminal widget, giving full TUI fidelity (`/model`, `/config`, slash commands, permission prompts) in a narrow left panel with an expand/collapse toggle.

## Non-goals

- Multi-session management (one session per workspace).
- Custom message rendering or chat UI.
- Cost tracking or session state badges.
- API-key based authentication.

## Acceptance Criteria

- **AC-1** On workspace open, `ClaudeTerminalManager.launch()` creates a `TerminalWidget` with `shellPath` = resolved `claude` executable, `cwd` = workspace root, `env.CLAUDE_CONFIG_DIR` = profile config dir (when set), and docks it in the left side panel at rank 1. Missing executable produces a blocking `MessageService.error` notification; no terminal is opened.

- **AC-2** Command `spexr.claude.toggleExpand` moves the single terminal widget between the left panel and the main area. Moving to main calls `ApplicationShell.addWidget(term, { area: "main" })` + `activateWidget`; moving back calls `addWidget(term, { area: "left", rank: 1 })` + `revealWidget`. The placement state is tracked on `ClaudeTerminalManager` so successive toggles alternate correctly.

- **AC-3** Profile selection from `SpexrBootstrapContribution` feeds `CLAUDE_CONFIG_DIR` into `TerminalWidget.env`. When more than one profile is detected the user is prompted once per project and the choice is persisted in `spexr.claude.profileId` / `spexr.claude.configDir` folder-scoped preferences.

- **AC-4** Spec hand-off (`spexr.spec.handoff`) and workflow step (`spexr.spec.workflow.action`) call `ClaudeTerminalManager.send(prompt + "\n")` then `reveal()`. No inbox or chat view is involved.

- **AC-5** `SpexrAgentBackendService.buildLaunchContext(workspaceRoot)` builds a system prompt via `buildSystemPrompt` (effective memory + active in-progress spec) and writes it to a temp file; `launch()` passes `["--append-system-prompt-file", <path>]` as `shellArgs` to the terminal. When context building fails the terminal launches without extra flags (graceful degradation).

## Notes

The embedded terminal runs inside node-pty (Theia's terminal backend), which provides a real PTY — raw-mode TUIs such as Claude Code should render correctly inside xterm.js. Flag for manual verification in the first end-to-end run.
