---
slug: 0002-agent-transport
title: Wire Claude Agent SDK transport
status: shipped
createdAt: 2026-05-09
relatedSpecs: 
workflowStep: ship
updatedAt: 2026-07-15
---
## Goal

Replace the stub `ClaudeAgentTransport` with a real binding to `@anthropic-ai/claude-agent-sdk` so the auto-start session in `@spexr/agent` produces real responses inside the desktop shell.

## Non-goals

- Multi-provider abstraction (other LLM vendors).
- Cost tracking dashboards.
- Tool-use / MCP server registration (separate spec).
- API-key based authentication (superseded by local CLI auth).

## Acceptance Criteria

- **AC-1** ~~A concrete `SdkClaudeAgentTransport` class implements `ClaudeAgentTransport` and streams assistant messages back via `onMessage`.~~ **Superseded by 0003-AC-4 and 0003-AC-5.** The SDK transport has been removed; the embedded terminal widget is the message surface.
- **AC-2** ~~Session lifecycle in the desktop shell: `workspace.ready` → `autoStartSession` → agent view shows "Ready" status — without manual action.~~ **Superseded by 0003-AC-1.** Session lifecycle is now terminal launch, not SDK auto-start.
- **AC-3** ~~Session errors surface in the agent header status badge and as a Theia notification.~~ **Superseded by 0003-AC-1.** Errors (missing CLI) surface as `MessageService.error` notifications; no status badge.
- **AC-4** The transport spawns the locally installed Claude Code CLI via `pathToClaudeCodeExecutable`. A missing binary is a blocking error surfaced to the user. An optional `spexr.claude.executablePath` preference overrides PATH auto-detection; when PATH yields more than one distinct candidate and no override is set, the backend reports an error asking the user to disambiguate. An invalid override (non-executable path) is validated before startup and surfaces as a blocking error. The model is omitted from SDK options so the CLI uses its own configured default. On workspace open, the backend scans the user's shell profile files (zsh/bash/fish on posix; PowerShell on Windows) for claude-launching aliases that set `CLAUDE_CONFIG_DIR`; when more than one profile is detected the frontend shows a quick-pick once per project and persists the choice (`spexr.claude.profileId`, `spexr.claude.configDir`) in folder-scoped preferences; subsequent opens reuse the stored choice without prompting. The chosen `CLAUDE_CONFIG_DIR` is passed to the spawned CLI via the SDK `env` option. **Still holds** — see 0003-AC-1 and 0003-AC-3 for the terminal-surface implementation.

## Notes

Implementation must keep `@spexr/agent` independent of Theia. The Theia binding lives in
`@spexr/theia-extensions` (`src/node` backend service + `src/browser` frontend proxy), not in
`apps/desktop` — that package carries no source, and all Theia DI bindings already live in the
extension package. The agent runs in the Theia backend (node) and streams to the frontend over
JSON-RPC; `@spexr/agent` stays Theia-agnostic, as required.

Authentication is delegated entirely to the locally installed Claude Code CLI (`~/.claude`). No
`ANTHROPIC_API_KEY` is injected by the transport; the CLI uses its own stored credentials.
