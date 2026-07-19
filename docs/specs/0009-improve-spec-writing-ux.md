---
slug: 0009-improve-spec-writing-ux
title: Improve spec writing UX
status: validated
createdAt: 2026-06-02
workflowStep: ship
updatedAt: 2026-07-19
forcedSteps: [ship]
---
> **What is this file.** Implementation contract for a live spec-validation companion panel. Audience: SPEXR contributors. Owner: marcello.barile. The spec is the contract; acceptance criteria below are the verifiable surface. No companion solution-proposal file.

## Goal

Specs are authored today as raw markdown in Monaco (`SPEC_OPEN`, `spec-widget.tsx:213` → `spexr-commands-contribution.ts:274`). The only structured feedback is the workflow stepper, which checks just `hasAuthoredAcceptanceCriteria` (`spec-widget.tsx:158`). Unsubstituted scaffold text, malformed acceptance criteria, and frontmatter errors stay invisible until something downstream breaks — `parseSpec` throws on invalid frontmatter (`parser.ts:50`) and silently drops unknown sections.

This spec adds a **live validation companion panel**: it tracks the active spec editor, reads the in-memory Monaco buffer, parses it, and surfaces findings (residual placeholders, missing/empty sections, malformed acceptance criteria, frontmatter coherence) on every keystroke — no save required. The panel is read-only; raw markdown remains the editing surface.

## Non-goals

- No editable form fields and no write-back to the file — the companion is read-only; raw markdown stays the editing surface.
- Does not gate or block workflow advancement — validation is advisory only.
- No auto-fix / quick-fixes that rewrite the spec; v1 surfaces findings, the fix is manual.
- Not a general markdown linter — only the SPEXR spec-contract sections are validated.
- No section→markdown serializer (the form-based editor approaches were rejected).

## Acceptance Criteria

- **AC-1** `lintSpec(raw, { filename, knownSlugs })` in `@spexr/spec` returns a `SpecLintReport` — findings carrying `severity` (`error | warn | info`), a section/line anchor, a message, and an optional `suggestion`. It tolerates parse failure: invalid frontmatter yields a finding and never throws.
- **AC-2** Placeholder/scaffold check: flags residual template text — the `spec-new` scaffold strings (e.g. "Describe the user-facing outcome…"), `TBD`/`TODO`, an empty `-` bullet, and HTML scaffold comments — each as a `warn` anchored to its section.
- **AC-3** Missing/empty sections: an empty Goal, empty Non-goals, and zero authored acceptance criteria each produce a finding; reuses `hasAuthoredAcceptanceCriteria`. Notes is optional (no finding).
- **AC-4** Malformed acceptance criteria: duplicate ids → `error`; an AC bullet without an `**AC-N**` id → `warn`; non-sequential numbering → `warn`; a vague/non-testable AC (no verifiable predicate) → `info`.
- **AC-5** Frontmatter coherence: invalid `status`, `slug` not equal to the filename stem, and an empty `title` → `error`; a `relatedSpecs` entry not matching an existing spec slug → `warn`.
- **AC-6** The panel widget tracks the active spec editor and reads the live Monaco model: findings refresh (debounced) on every content change without requiring a save; switching editors re-targets; a non-spec editor (or no editor) shows a neutral/empty state.
- **AC-7** Findings render grouped by severity with section labels; clicking a finding focuses the editor and, where the line is known, navigates to it; a count summary is shown (e.g. "2 errors, 3 warnings").

## UI

The panel follows the same shape as `SpexrSpecResourcesWidget` (`spec-resources-widget.tsx`) — a `ReactWidget` tracking the active editor — and lives next to it so both companions read the same active spec.

### Placement & registration

- **Area** `bottom`, alongside *Linked resources*. `SpexrSpecLintViewContribution extends AbstractViewContribution`, `area: "bottom"`, `rank: 2` (Linked resources stays rank 1).
- **View id** `spexr.view.spec-lint`; widget `SpexrSpecLintWidget`; `toggleCommandId: "spexr.view.spec-lint.toggle"`.
- **Tab** `title.label = "Spec validation"`, `title.iconClass = "codicon codicon-checklist"`, `title.closable = true`. The count summary (AC-7) is also surfaced as a `title.badge` so the error/warning count is visible from the collapsed tab.

### Layout

```
┌─ Linked resources │ Spec validation ──────────────┐
│ 0008-ship-to-pr — ⛔ 1 error · ⚠ 2 warnings        │  ← header / summary
├───────────────────────────────────────────────────┤
│ Acceptance Criteria                                │  ← section group header
│   ⛔ Duplicate id AC-3                    L30 →     │  ← finding row
│   ⚠ AC-5 has no verifiable predicate     L41 →     │
│ Frontmatter                                        │
│   ⛔ slug ≠ filename stem                 L2  →     │
└───────────────────────────────────────────────────┘
```

- **Header / summary** — spec title + aggregate counts (`AC-7`). When there are zero findings the header shows a positive `✓ No issues` state instead of counts.
- **Section group headers** — findings are grouped by severity first (errors, then warnings, then info), and within the rendered list each finding carries its section label (Goal / Non-goals / Acceptance Criteria / Frontmatter). Empty groups are not rendered.
- **Finding row** anatomy: severity icon · message (with the offending id/snippet) · optional `suggestion` as muted secondary text · line anchor (`L<n>`, omitted when the rule has no line) right-aligned. The whole row is a button; clicking it focuses the editor and, when the line is known, reveals/selects that line (`AC-7`).

### Severity vocabulary

Reuses the `DriftFinding`/`SpecLintFinding` severities (`error | warn | info`) with theme-token colors, no hardcoded hex:

| Severity | Icon (`codicon`) | Color token |
|----------|------------------|-------------|
| `error`  | `codicon-error`   | `--theia-editorError-foreground`   |
| `warn`   | `codicon-warning` | `--theia-editorWarning-foreground` |
| `info`   | `codicon-info`    | `--theia-editorInfo-foreground`    |

### States

- **No active spec editor** (non-spec editor or none) — neutral empty state: *"Open a spec to validate it."* (mirrors the *Linked resources* empty copy).
- **Clean spec** (zero findings) — positive state: *"✓ No issues found."*, no list.
- **Parse failure** — surfaced as a single `error` finding (per `AC-1`), never a blank/crashed panel.

Styling reuses the existing `spexr-*` BEM classes and `spexr-button` variants where applicable; new classes are namespaced `spexr-spec-lint__*`.

## Testing

- Unit tests for `lintSpec` in `packages/spec`: each rule fires on a crafted fixture and stays silent on a clean spec; parse-failure tolerance (bad frontmatter → finding, not throw); a real spec (e.g. 0008) yields zero `error` findings.
- Live refresh: editing the Monaco buffer updates findings without a save (widget test or manual).

## Notes

- Validation lives as a pure `lintSpec` function in `@spexr/spec`, alongside `drift-detector.ts`, so it is unit-testable independently of the Theia widget; the widget is a thin renderer hooking `EditorManager`.
- `SpecLintFinding` mirrors the existing `DriftFinding` shape (`types.ts:79`) for a consistent findings vocabulary across lint and drift.
