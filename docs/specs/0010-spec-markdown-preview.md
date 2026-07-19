---
slug: 0010-spec-markdown-preview
title: Spec markdown preview
status: shipped
createdAt: 2026-06-04
workflowStep: ship
updatedAt: 2026-07-15
---
> **What is this file.** Implementation contract for a live markdown preview panel that opens split-right alongside the spec editor. Audience: SPEXR contributors. Owner: marcello.barile. This spec is the implementation contract; no companion solution-proposal file.

## Goal

Spec files are authored as raw markdown in Monaco. There is no way to see the rendered output without leaving the IDE. This spec adds a live markdown preview that opens automatically, split-right of the Monaco editor, every time a spec file is opened — regardless of how it was opened (command, file navigator, layout restore). The preview re-renders on every keystroke (debounced) without requiring a save.

## Non-goals

- No custom SPEXR-specific rendering (callouts, AC badges, etc.) — plain GitHub-flavoured markdown rendering only.
- No two-way sync (clicking rendered text does not move the Monaco cursor).
- No print/export capability.
- Does not replace the existing Spec validation (lint) or Linked resources bottom panels.
- No syntax highlighting inside fenced code blocks in v1.

## Acceptance Criteria

- **AC-1** When a spec file (matching `^\d{4}-[a-z0-9][a-z0-9-]*\.md$` under `docs/specs/`) is opened by any means (command, file navigator, layout restore), `SpexrSpecPreviewWidget` opens split-right of that editor in the main area without requiring any user action.
- **AC-2** The preview re-renders the live Monaco buffer content on every content change, debounced at 200 ms, without a file save.
- **AC-3** Switching focus to a different spec editor retargets the preview to that spec's buffer; the preview title updates to the new spec's filename.
- **AC-4** Switching focus to a non-spec editor does not clear the preview — it keeps showing the last spec until no spec editor is open anywhere, at which point it shows the empty state *"Open a spec to preview it."*
- **AC-5** If the user manually closes the preview widget and then switches to a different spec (different URI), the preview reopens split-right automatically. If they reopen the same spec, it does not reopen (respects the manual close).
- **AC-6** A *"Toggle preview"* toolbar item (`codicon-open-preview`) appears in the editor toolbar whenever a spec is active; clicking it opens/reveals the preview widget split-right, overriding the manual-close flag.
- **AC-7** Rendered HTML is stripped of `<script>` and `<iframe>` elements before insertion into the DOM.

## Architecture

### New files

| File | Role |
|------|------|
| `packages/theia-extensions/src/browser/views/spec-preview-widget.tsx` | `SpexrSpecPreviewWidget extends ReactWidget` — singleton, renders markdown |
| `packages/theia-extensions/src/browser/views/spec-preview-contribution.ts` | `SpexrSpecPreviewContribution implements FrontendApplicationContribution` — wires auto-open on `editorManager.onCreated` |
| `packages/theia-extensions/src/browser/views/spec-preview-view-contribution.ts` | `SpexrSpecPreviewViewContribution extends AbstractViewContribution` — registers the widget with Theia DI |

### Modified files

| File | Change |
|------|--------|
| `packages/theia-extensions/src/browser/views/spec-editor-toolbar-contribution.ts` | Add *Toggle preview* toolbar item (AC-6) |
| `packages/theia-extensions/src/browser/spexr-frontend-module.ts` | Bind the three new contributions |
| `packages/theia-extensions/package.json` | Add `marked` as a direct dependency |

### Data flow

```
editorManager.onCreated(editorWidget)
  └─ isSpecUri(editorWidget) → true
       └─ SpexrSpecPreviewContribution
            └─ shell.addWidget(previewWidget, { ref: editorWidget, mode: 'split-right' })

editorManager.onCurrentEditorChanged(widget)
  └─ isSpecUri → true  → previewWidget.retarget(widget)
  └─ isSpecUri → false → keep last spec; if no spec open anywhere → empty state

editorWidget.editor.onDocumentContentChanged()
  └─ debounce(200ms)
       └─ marked.parse(getText()) → strip <script>/<iframe> → setState({ html })
            └─ ReactWidget.update()
```

### Manual-close tracking

`SpexrSpecPreviewContribution` holds:
- `lastOpenedUri: string | undefined` — URI of the spec for which the preview was last auto-opened
- `userClosed: boolean` — set to `true` when `previewWidget.onCloseRequest` fires

Auto-open logic: `if (!userClosed || uri !== lastOpenedUri) { open(); userClosed = false; lastOpenedUri = uri; }`

Toolbar toggle always opens (resets `userClosed = false`).

## UI

- **Widget title**: `"Preview: <filename>"` (e.g. `"Preview: 0010-spec-markdown-preview.md"`)
- **Icon**: `codicon codicon-open-preview`
- **Container**: `<div class="spexr-spec-preview">` with `overflow-y: auto`, `padding: 12px 16px`, standard Theia `--theia-editor-background` background
- **Rendered content**: wrapped in `<div class="spexr-spec-preview__body">` — plain browser defaults for typography; no external CSS class dependency
- **Empty state**: `<p class="spexr-spec-preview__empty">Open a spec to preview it.</p>`

## Dependency

`marked` v14 is already present as a transitive dependency. Add as a direct dep:

```json
"marked": "^14.0.0"
```

`@types/marked` is not needed — `marked` v14 ships its own TypeScript declarations.
