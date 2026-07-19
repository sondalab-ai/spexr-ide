---
slug: 0004-expert-agents
title: Expert agents — persona presets selectable per project
status: shipped
createdAt: 2026-05-23
relatedSpecs: 
workflowStep: ship
updatedAt: 2026-07-15
forcedSteps: [ship]
---
## Goal

Turn the right-panel Memory view into a tabbed surface (tab 1 **Memory**, tab 2 **Esperti**) and add a marketplace of built-in "expert agents". Each expert is a persona — a curated system-prompt preset with its own name, icon, and accent color. The user adds experts from the built-in marketplace to the project, then launches a Claude session as a chosen expert. Exactly one expert is active at a time, and the active expert is recognizable everywhere it appears (panel chip + terminal title/icon).

An expert is a `--append-system-prompt` persona layered on top of SPEXR's base prompt, reusing the existing single embedded `claude` terminal (spec 0003). No new transport, no concurrent sessions.

## Non-goals (v1)

- A custom-expert authoring UI (experts persist as `docs/agents/*.md`, so a user can hand-write one, but no in-app editor ships now).
- Remote / downloadable marketplace.
- Multiple concurrent expert sessions (one active expert, one terminal).
- Per-expert MCP servers, tool allow-lists, or separate config dirs.
- Per-expert model selection UI (the `model` field exists in the type but the v1 catalog leaves it unset → CLI default).

## Data model

`ExpertAgent` — node-free DTO in `common/agent-protocol.ts`:

```ts
interface ExpertAgent {
  readonly id: string;          // stable kebab-case, e.g. "review"
  readonly name: string;        // display, e.g. "Revisione"
  readonly icon: string;        // codicon class, e.g. "codicon-search"
  readonly color: string;       // accent (hex or theme color id)
  readonly description: string; // one line for the catalog card
  readonly systemPrompt: string;// persona instructions appended to base prompt
  readonly model?: string;      // optional; omitted in v1 catalog
}
```

**Marketplace (built-in source):** `packages/agent/src/experts/catalog.ts` exports a readonly array of 6 presets — **brainstorming** (includes analysis/exploration), **design**, **review**, **marketing**, **dri** (tracks implementation progress against specs and reports to the user), **software-engineering** (implements the plan: production code + tests) — each with a curated `systemPrompt`. All presets except **marketing** are installed by default when a project is scaffolded, and each workflow step maps to a default expert (`WORKFLOW_STEP_EXPERT` in `@spexr/spec`) that is auto-activated on step handoff, falling back to the base agent when the mapped expert is not installed.

**Installed experts (project source of truth):** one markdown file per installed expert at `docs/agents/<id>.md`, consistent with `docs/memory` and `docs/specs`. Frontmatter holds `id/name/icon/color/model?`, the body is the `systemPrompt`. Parsed with `gray-matter` (already a `@spexr/memory` dep). "+ Aggiungi" copies a marketplace preset into `docs/agents/<id>.md`; "Rimuovi" deletes the file. A hand-written file in `docs/agents/` is a valid expert too — this unifies built-in and future custom experts from day one.

**Active selection (UI state, not content):** `spexr.experts.activeId` — folder-scoped Theia preference, `string | undefined`.

## Acceptance Criteria

- **AC-1** The right panel shows two tabbed views: the existing Memory view (rank 1) and a new `SpexrExpertsViewContribution` → `SpexrExpertsWidget` (`area: "right"`, rank 2). Tab labels read "Memory" and "Esperti". Toggling either view does not affect the other.

- **AC-2** `SpexrAgentService.listMarketplaceExperts(): ExpertAgentDto[]` returns the built-in catalog over RPC; every entry has a unique `id` and non-empty `name`, `icon`, `color`, `description`, `systemPrompt`. The installed list is read on the frontend by scanning `docs/agents/*.md` via Theia's `FileService` (consistent with the Memory panel, giving live refresh on file changes); malformed files are skipped (never crash the panel).

- **AC-3** The Esperti widget renders layout A: a **"Nel progetto"** section listing installed experts and a **"Marketplace"** section listing marketplace entries whose `id` is not already installed. A marketplace card exposes **"+ Aggiungi"** (`spexr.experts.add`) which writes `docs/agents/<id>.md`. An installed non-active expert exposes **"Avvia"** (`spexr.experts.start`) and **"Rimuovi"** (`spexr.experts.remove`, deletes the file). The widget refreshes when `docs/agents/` or `spexr.experts.activeId` changes.

- **AC-4** `spexr.experts.start(id)` sets `spexr.experts.activeId` and calls `ClaudeTerminalManager.startWithExpert(id)`. Because the `claude` process bakes its system prompt at launch, this relaunches the single workspace terminal (spec 0003) with the new persona; if the requested expert is already the active running one, the existing terminal is just revealed. No confirmation prompt — switching is a plain relaunch of the one terminal slot. The launched terminal title is `Agente · <name>`, its `iconClass` is the expert icon.

- **AC-5** `buildLaunchContext(workspaceRoot, expertId?)` appends the persona — read from `docs/agents/<expertId>.md` — to the base prompt built by `buildSystemPrompt` before writing the temp file. With no `expertId` the context is identical to spec 0003 (base prompt only, title "Agente") — fully backward compatible. The bootstrap auto-start passes `spexr.experts.activeId` when set.

- **AC-6** The active expert is highlighted in the "Nel progetto" section with the expert's accent color (border/background) and an "attivo" marker, and the same accent + icon appear in the terminal widget title, so the active expert is recognizable from both the panel and the terminal.

- **AC-7** Removing the active expert (`spexr.experts.remove`) deletes `docs/agents/<id>.md` and clears `spexr.experts.activeId`; the next launch falls back to the base prompt. Removing a non-active installed expert only deletes its file.

- **AC-8** The active expert's "In project" entry exposes a **"Deactivate"** action (`spexr.experts.deactivate`) that clears `spexr.experts.activeId` and relaunches the single terminal as the base agent (no persona, title "Agent"), leaving the installed `docs/agents/<id>.md` file in place. No confirmation — it is a plain relaunch of the one terminal slot.

## Testing

- Marketplace catalog integrity unit test: ids unique, all required fields non-empty (`packages/agent`).
- Installed-expert markdown round-trip: write a preset → parse it back → fields preserved; malformed file is skipped (`packages/agent` or backend).
- `buildSystemPrompt` includes the persona section when a persona is supplied and omits it otherwise (`packages/agent`).
- Existing `@spexr/theia-extensions` and `@spexr/spec` suites stay green.

## Notes

- Switching experts relaunches the single terminal because the `claude` system prompt is fixed at process start — it cannot be hot-swapped. The previous conversation persists on disk and is recoverable via the CLI's `/resume`; v1 does not surface that.
- Accent color in the xterm title is best-effort (Theia terminal titles are text + icon class); the authoritative recognizability cue is the panel chip plus the `Agente · <name>` title.
- The persona is appended after SPEXR's identity/house-rules so project rules still bound the expert's behavior.
- `docs/agents/` joins `docs/memory` and `docs/specs` under the workspace `docs/` container; update the README workspace-layout section when this ships.

## How experts intersect with Claude Code (v1 reality)

A v1 expert is a thin, additive persona layer — nothing more. It is injected via `--append-system-prompt-file` (append, not replace), so it never clobbers Claude Code's core system prompt and does not register, gate, enable, or disable any capability. Effective precedence, strongest first:

1. Claude Code core system prompt (agent identity, tool use, safety).
2. `CLAUDE.md` (user + project) and native memory (auto-loaded by the CLI; `docs/memory` is symlinked here).
3. SPEXR base append (identity + active spec + house rules).
4. Expert persona (the `# Expert Persona` section — last, weakest).

Consequences:
- **Skills / plugins / hooks** (e.g. installed skills, MCP servers, SessionStart hooks) keep working unchanged in an expert session; the persona is prose and cannot turn them on/off. Skills with strong activation rules may steer the flow regardless of the active expert.
- **Account/profile (`CLAUDE_CONFIG_DIR`) is orthogonal**: the same expert launched under a different account inherits *that* account's skills/plugins/memory/CLAUDE.md. An expert carries only persona text + optional `model`, never capabilities.
- **Claude Code native subagents** (`.claude/agents/*.md`) are a different mechanism (delegated sub-tasks via the Task tool) and do not collide; an expert session can still spawn them.
- **Design guidance:** keep preset `systemPrompt`s narrow (role/focus/output), and leave general working rules to house-rules + `CLAUDE.md`, so the layers do not duplicate or contradict each other.

## Future direction — capability-carrying experts (out of scope, later)

v1 experts shape *behaviour* (persona) only. A natural next step is experts that also carry *capabilities*, so picking an expert reconfigures what the session can do, not just how it talks. Options, roughly increasing in cost:

- **Per-expert model**: already modelled (`ExpertAgent.model`); v1 leaves it unset. Wiring `--model` per expert is the cheapest capability hook.
- **Per-expert skills / tool allow-list**: an expert declares which skills or tools are in/out of scope for its session. Requires a mechanism beyond a system-prompt string — e.g. generating a scoped settings file or a Claude Code subagent definition at launch.
- **Per-expert MCP servers / config dir**: an expert brings its own toolset (custom MCP servers, a dedicated `CLAUDE_CONFIG_DIR` overlay). This is the heaviest: it touches account/profile resolution and process env, and interacts with the per-project profile selection from spec 0002/0003.

Each of these turns "expert" from a prompt preset into a session profile. Worth a dedicated spec when prioritised; the v1 `docs/agents/<id>.md` + `ExpertAgent` shape was chosen so these fields can be added without breaking the file format.
