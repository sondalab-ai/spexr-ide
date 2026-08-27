# MEMORY index

One line per memory. Linked file holds the body.

## Project

- [Project overview](project-overview.md) — agent-centric IDE, Theia + Theia AI, TypeScript end-to-end.
- [Theme architecture](theme-architecture.md) — CSS vars + data-sl-theme on root; custom tokens need --sl- prefix.
- [Layout supersession (spec 0001 AC-4)](layout-supersession-ac4.md) — agent is a left-panel terminal, not the main panel.

## Reference

- [TypeScript version baseline](typescript-version-baseline.md) — repo runs TS 6.0.3 strict; spec 0001 was written for 5.6.
- [Theia main-area widget visibility](theia-main-area-widget-visibility.md) — main-area ReactWidget needs tabIndex/focus or tab events never fire; use getCurrentWidget("main"), not currentEditor.

## Feedback

- [Validation after edits](validation-after-edits.md) — always run lint, typecheck, focused tests after writes.
- [Propose then implement](propose-then-implement.md) — non-trivial work waits for OK before edits.
- [One spec, one commit](one-spec-one-commit.md) — ship each spec as its own small reviewable commit; avoid mega-commits.
