# MEMORY index

One line per memory. Linked file holds the body.

## Project

- [Project overview](project-overview.md) — agent-centric IDE, Theia + Theia AI, TypeScript end-to-end.
- [Theme architecture](theme-architecture.md) — CSS vars + data-sl-theme on root; custom tokens need --sl- prefix.
- [Layout supersession (spec 0001 AC-4)](layout-supersession-ac4.md) — agent is a left-panel terminal, not the main panel.

## Reference

- [TypeScript version baseline](typescript-version-baseline.md) — repo runs TS 6.0.3 strict; spec 0001 was written for 5.6.
- [Theia main-area widget visibility](theia-main-area-widget-visibility.md) — main-area ReactWidget needs tabIndex/focus or tab events never fire; use getCurrentWidget("main"), not currentEditor.
- [Theia backend orphans](theia-backend-orphans.md) — the forked backend is killed only on app quit; an unclean main-process death leaves it running forever.
- [Theia colors: CSS vs registry](theia-colors-css-vs-registry.md) — our `--theia-*` overrides never reach colors Theia reads from the registry in JS (xterm, preload background).
- [Electron prefers-color-scheme](electron-prefers-color-scheme.md) — it follows nativeTheme.themeSource, pinned by Theia to the app's theme; not the OS setting.
- [Electron window background flash](electron-window-background-flash.md) — a colour before the first paint is the window's own background; windowstate outranks windowOptions and re-saves itself.
- [Theia tree scroll snap-back](theia-tree-scroll-snapback.md) — the virtualized tree scrolled back to the focused row on every re-render; patched in @theia/core.
- [Git status untracked expansion](git-status-untracked-expansion.md) — the panel lists every untracked file where terminal `git status` collapses the directory; both counts are right.
- [Electron single-instance lock](electron-single-instance-lock.md) — a second instance quits silently, so a rebuilt app looks unchanged; quit the running one before verifying UI.

## Feedback

- [Validation after edits](validation-after-edits.md) — always run lint, typecheck, focused tests after writes.
- [Propose then implement](propose-then-implement.md) — non-trivial work waits for OK before edits.
- [One spec, one commit](one-spec-one-commit.md) — ship each spec as its own small reviewable commit; avoid mega-commits.
- [Config dir inherited from the launching shell](config-dir-inherited-from-the-launching-shell.md) — SPEXR inherits CLAUDE_CONFIG_DIR from the shell that started it; every launch path must set the account itself.
- [Which Claude account a config dir uses](which-claude-account-a-config-dir-uses.md) — read it with `claude auth status`; the keychain entry differs by whether the variable is set at all.
- [Memory notes are public](memory-notes-are-public.md) — docs/memory/ ships in a public repo; keep personal and account details out.
- [darkfactory-wall-search-filtering-must-apply-only-to-the-gri](darkfactory-wall-search-filtering-must-apply-only-to-the-gri.md) — Darkfactory wall: search filtering must apply only to the grid/groups (rest); this.launched and expanded own TerminalMounts and must stay mounted, or live sessions are lost.
- [summarize-planfocus-resolve-from-this-index-which-holds-only](summarize-planfocus-resolve-from-this-index-which-holds-only.md) — summarize()/planFocus() resolve from this.index, which holds only the 60 newest sessions (RECENT_LIMIT) — session-search hits outside that window must be registered there or they cannot be opened.
- [darkfactory-push-reaches-only-the-newest-window](darkfactory-push-reaches-only-the-newest-window.md) — The darkfactory backend service is a singleton with one client field, so tile/follow pushes reach only the most recently opened window.
- [pnpm-build-dev-failing-with-cannot-resolve-package-tm-gramma](pnpm-build-dev-failing-with-cannot-resolve-package-tm-gramma.md) — pnpm build:dev failing with 'Cannot resolve package tm-grammars' is a stale node_modules, not a code error: the dep is in package.json and the lockfile but not installed. Fix with pnpm install --frozen-lockfile.
- [spexr-worktrees-lack-packages-node-modules-and-the-gitignore](spexr-worktrees-lack-packages-node-modules-and-the-gitignore.md) — spexr worktrees lack packages/*/node_modules and the gitignored embedding weights under packages/theia-extensions/resources/models/Xenova — run pnpm install, and symlink that dir from the main checkout, or embedding-model.integration.test.ts fails for reasons unrelated to the change.
- [spexr-can-adopt-sondalab-ui-kit-sl-component-classes-without](spexr-can-adopt-sondalab-ui-kit-sl-component-classes-without.md) — spexr can adopt @sondalab/ui-kit .sl-* component classes without collisions: kit components.css styles only .sl-* classes, and Theia core has no bare button/input/select resets (verified 2026-09-24). Kit has no sl-btn--danger, and sl-segmented reads aria-selected, not aria-pressed.
- [never-run-full-pnpm-test-or-the-full-e2e-suite-unthrottled-i](never-run-full-pnpm-test-or-the-full-e2e-suite-unthrottled-i.md) — Unthrottled test runs crashed the 18 GB dev machine on 2026-09-24 (turbo ran ~10 packages at once, each vitest forking cores-1). Test scripts now cap it (--maxWorkers=2, turbo --concurrency=2); keep the caps, prefer focused tests, and run e2e with a --user-data-dir per launch when a SPEXR instance is open.
- [spexr-terminals-theia-xterm-5-3-use-the-unicode-6-width-tabl](spexr-terminals-theia-xterm-5-3-use-the-unicode-6-width-tabl.md) — SPEXR terminals (Theia xterm 5.3) use the Unicode 6 width table: every emoji above U+1FFFF is 1 cell wide, but Claude Code treats them as 2, causing overlapping icons and stale characters like 'fmain'. Fix: load xterm-addon-unicode11@0.6.0 and set activeVersion 11; term.unicode requires allowProposedApi.
- [Sondalab effects dress only added nodes](sondalab-effects-dress-only-added-nodes.md) — mount() dresses glass hosts on insertion only; static className + span-wrapped dynamic labels in React.
- [Sondalab glass inside glass loses its lens](sondalab-glass-inside-glass-loses-its-lens.md) — only leaf cards take sl-fx-glass--pane; clear our card backgrounds once layers exist, and restate the swell transition.
- [spexr-never-pkill-processes-by-worktree-path-a-user-launched](spexr-never-pkill-processes-by-worktree-path-a-user-launched.md) — Never kill processes by a worktree path (a user-launched SPEXR may run from it); local Electron E2E cannot launch in the agent sandbox, read GitHub CI instead.
- [spexr-idle-cpu-2026-09-25-plain-git-status-creates-deletes-g](spexr-idle-cpu-2026-09-25-plain-git-status-creates-deletes-g.md) — SPEXR idle CPU (2026-09-25): plain 'git status' creates/deletes .git/index.lock even with no changes, so SPEXR's .git watcher and Theia's file watcher re-trigger status refresh across all repos in a ~2 Hz loop; read-only git calls need GIT_OPTIONAL_LOCKS=0 (--no-optional-locks).
- [simple-git-env-makes-it-vet-the-whole-passed-environment-inc](simple-git-env-makes-it-vet-the-whole-passed-environment-inc.md) — simple-git .env() makes it vet the WHOLE passed environment (incl. GIT_CONFIG_COUNT/KEY/VALUE entries): an inherited EDITOR/PAGER/GIT_EDITOR/credential helper throws 'not permitted without enabling allowUnsafe*' on every call unless those unsafe categories are granted. spexr's backgroundFetch never worked before 2026-09-25 because its own GIT_ASKPASS tripped this.
- [a-read-only-opencode-db-query-still-writes-its-data-dir-open](a-read-only-opencode-db-query-still-writes-its-data-dir-open.md) — A read-only 'opencode db' query still writes its data dir (opencode.db, -shm, log/, repos/), so Dark Factory's watcher on that dir re-triggers the scan that ran the query.
- [spexr-css-overrides-the-ui-kit-s-sl-btn-sm-app-wide-text-sm](spexr-css-overrides-the-ui-kit-s-sl-btn-sm-app-wide-text-sm.md) — spexr.css overrides the ui-kit's .sl-btn--sm app-wide (text-sm 14px, space-1/space-3 padding vs kit's text-xs 12px, 0.35/0.6rem) since 8036f19; kit has no small icon button, so spec stepper sizes sl-icon-btn to 1.75rem to sit level with small buttons.
