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

- **AC-1** On workspace open, `ClaudeTerminalManager.launch()` creates a `TerminalWidget` with `shellPath` = resolved `claude` executable, `cwd` = workspace root, `env.CLAUDE_CONFIG_DIR` = the account's config dir, and empty when the account's command sets it itself, and docks it in the left side panel at rank 1. Missing executable produces a blocking `MessageService.error` notification; no terminal is opened.

- **AC-2** Command `spexr.claude.toggleExpand` moves the single terminal widget between the left panel and the main area. Moving to main calls `ApplicationShell.addWidget(term, { area: "main" })` + `activateWidget`; moving back calls `addWidget(term, { area: "left", rank: 1 })` + `revealWidget`. The placement state is tracked on `ClaudeTerminalManager` so successive toggles alternate correctly.

- **AC-3** The account resolved by `resolveAccount` feeds `CLAUDE_CONFIG_DIR` into `TerminalWidget.env`. The account is the launch profile named by `spexr.claude.activeProfile`, or the only configured profile when there is one; when several are configured and none is chosen the user is prompted once per machine and the answer is persisted at user scope. Dismissing the prompt cancels the launch. `Spexr: Select Claude account` changes it later.

- **AC-4** Spec hand-off (`spexr.spec.handoff`) and workflow step (`spexr.spec.workflow.action`) call `ClaudeTerminalManager.send(prompt + "\n")` then `reveal()`. No inbox or chat view is involved.

- **AC-5** `SpexrAgentBackendService.buildLaunchContext(workspaceRoot)` builds a system prompt via `buildSystemPrompt` (effective memory + active in-progress spec) and writes it to a temp file; `launch()` passes `["--append-system-prompt-file", <path>]` as `shellArgs` to the terminal. When context building fails the terminal launches without extra flags (graceful degradation).

## Notes

The embedded terminal runs inside node-pty (Theia's terminal backend), which provides a real PTY — raw-mode TUIs such as Claude Code should render correctly inside xterm.js. Flag for manual verification in the first end-to-end run.
