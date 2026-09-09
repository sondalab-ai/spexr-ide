---
slug: 0015-vscode-plugin-host
title: Language intelligence — VS Code plugin host and Open VSX
status: draft
createdAt: 2026-09-08
workflowStep: plan
---
> **What is this file.** Implementation contract for giving SPEXR's editor real
> language intelligence — go-to-definition, find-references, hover, semantic
> completion, diagnostics, rename — by adopting Theia's VS Code plugin host and
> the Open VSX marketplace. Audience: SPEXR contributors. Owner:
> marcello.barile. This spec supersedes the "No VS Code plugin host" non-goal
> recorded in `docs/specs/0014-git-hardening.md`; see **Relationship to 0014**
> below. This spec is the implementation contract; where it disagrees with 0014
> on the plugin host, this spec wins.

## Goal

Today the editor has no language intelligence at all, in any language. The only
language support is `SpexrLanguageGrammarContribution`, which registers twelve
TextMate grammars (`typescript`, `javascript`, `json`, `css`, `html`, `xml`,
`c`, `cpp`, `java`, `python`, `rust`, `go`) — syntax colouring and nothing
else. No definition, reference, hover or completion provider is registered
anywhere in `packages/`.

The cause is structural: the application does not depend on `@theia/plugin-ext`
or `@theia/plugin-ext-vscode`, and declares no `theiaPlugins`. In Theia,
language intelligence is delivered by VS Code extensions running in the plugin
host. Without it Monaco is a syntax-coloured text editor.

This spec adopts the plugin host, ships the VS Code builtin extensions, and
adds the Open VSX marketplace so users can install language support SPEXR does
not bundle.

## Relationship to 0014

`docs/specs/0014-git-hardening.md` lists "No VS Code plugin host" as a
non-goal, on the grounds that adopting `@theia/plugin-ext` would trade control
over the agent-facing git integration for a large new runtime surface. That
decision stands **for git**: the custom `@theia/scm` implementation remains
SPEXR's source-control surface, and this spec explicitly excludes the builtin
git extensions so no second `ScmProvider` is registered.

What changes is the premise for *language* tooling. For git there was a cheap
custom alternative, and it was built. For language intelligence there is none:
hand-writing Monaco providers over a backend LSP bridge, language by language,
costs as much as the plugin host and delivers a fraction of it. The asymmetry,
not a change of taste, is what reopens the decision.

## Coverage: builtins versus marketplace

This distinction generates the most wrong expectations, so it is stated up
front.

The `vscode-builtin-extensions` tarball ships **language servers** for
TypeScript/JavaScript, JSON, CSS/LESS/SCSS, HTML and Markdown. For Python, Go,
Rust, Java and C/C++ the builtins (`vscode.python`, `vscode.go`,
`vscode.rust`, …) contribute **grammars and language configuration only** — no
intelligence. Eclipse Theia's own application confirms this by shipping the
tarball *and*, separately, `ms-python.python` from Open VSX.

Therefore:

| Language | Where intelligence comes from |
|---|---|
| TypeScript, JavaScript, JSON, CSS/LESS/SCSS, HTML, Markdown | bundled builtins, works on first launch |
| Python, Go, Rust, Java, C/C++, everything else | user installs from Open VSX |

## Status vocabulary

| Term | Meaning |
|---|---|
| `Shipped` | merged to `main` and reachable by users |
| `Planned` | specified here, not yet implemented |
| `Deferred` | deliberately excluded, listed under Non-goals |

Everything in this spec is `Planned` until its slice merges.

## Non-goals

- **No pre-seeded language extensions beyond the builtins.** Go, Rust, Python
  and Java extensions each depend on an external toolchain the user may not
  have (`gopls`, a platform-specific `rust-analyzer` binary, Pylance — which is
  not published on Open VSX — a JDK). Bundling them adds installer weight for
  an experience that silently fails without those tools. The marketplace is the
  surface for them.
- **No marketplace mirror.** open-vsx.org is used directly; no
  `--ovsx-router-config`, no self-hosted registry.
- **No replacement of SPEXR's SCM.** The builtin git extensions are excluded;
  the custom `@theia/scm` implementation from 0014 stays.
- **No curation of the non-AI transitive Theia packages.** `@theia/plugin-ext`
  pulls in debug, task, test, timeline, notebook, search-in-workspace, output,
  console, bulk-edit, call/type-hierarchy and editor-preview, and Theia's
  extension collector registers transitive packages' modules. Their views and
  menus are accepted as-is. Only Theia's own AI surface is curated, because it
  overlaps SPEXR's agent surface.

## Acceptance Criteria

### Slice 1 — Plugin host and builtins

- **AC-1 Plugin host dependencies.** `apps/desktop/package.json` depends on
  `@theia/plugin-ext`, `@theia/plugin-ext-vscode` and `@theia/vsx-registry`,
  pinned to the exact Theia line the application runs (no caret), matching the
  existing `@theia/scm` pin.

- **AC-2 Builtins declared and downloaded.** The application declares
  `theiaPluginsDir` and a `theiaPlugins` entry for the
  `vscode-builtin-extensions` tarball whose VS Code version matches
  `@theia/monaco-editor-core`. A `download:plugins` script runs `theia
  download:plugins`; it is an uncached turbo task the `build` task depends on,
  and is called directly by `build:dev`, which bypasses turbo. The download
  directory is git-ignored.

- **AC-3 Git builtins excluded.** `theiaPluginsExcludeIds` lists the builtin
  git extensions, so no second `ScmProvider` is registered and the Source
  Control panel is not duplicated. `vscode.github-authentication` is **not**
  excluded: third-party extensions installed from the marketplace depend on it.
  The excluded ids are verified against the tarball's own manifests, not
  assumed from VS Code convention.

- **AC-4 Language intelligence in development.** With `pnpm dev`, opening a
  `.ts` file in this repository and invoking go-to-definition on an imported
  symbol navigates to its declaration; hover shows the inferred type; a
  deliberately introduced type error appears in the Problems panel. The same
  holds for a `.json` file with a schema and a `.css` file. Python and Go are
  explicitly **not** covered by this criterion — see **Coverage** above.

### Slice 2 — Hand-written grammars removed

- **AC-5 No duplicate language registration.** `SpexrLanguageGrammarContribution`
  and its bindings are removed, along with the `tm-grammars` dependency if
  nothing else uses it. Keeping both would register each of the twelve languages
  twice, since the builtins claim the same language ids. Before removing it,
  every language id and every file extension the contribution declared is
  checked against the `contributes.languages` manifests of the downloaded
  plugins, so nothing is dropped on the assumption that a builtin covers it.
  Syntax highlighting for those twelve languages is unchanged after removal, and
  the frontend console reports no duplicate-registration warning.

### Slice 3 — Theia AI surface curated

- **AC-6 Theia's AI surface is not visible.** `@theia/ai-core` and
  `@theia/ai-mcp` arrive transitively. Theia already hides the `ai-features.*`
  preferences itself; what remains visible is the
  `ai-features.openConfiguration` placeholder (inert here, since
  `@theia/ai-ide` is absent), the `ai-chat-ui.show-settings` command, and
  `@theia/ai-mcp`'s MCP configuration commands. None of these appear in the
  command palette or the Settings UI. The set of hidden ids lives in a separate
  pure module with unit tests, following the existing policy modules in
  `packages/theia-extensions/src/browser`.

### Slice 4 — Electron packaging

- **AC-7 Plugins reach the packaged application.** A wrapper entry point
  resolves the bundled plugin directory — under `process.resourcesPath` when
  running from inside the asar, otherwise the development path — sets
  `THEIA_DEFAULT_PLUGINS` to it, and hands over to the generated
  `electron-main`. `electron-builder.yml` copies the plugin directory via
  `extraResources` and includes the wrapper in its explicit `files` allowlist;
  `main` and `extraMetadata.main` both point at the wrapper.

- **AC-8 AppImage runs from a writable plugin directory.** The AppImage mount
  point is read-only. On that target the wrapper copies the bundled builtins
  into a writable directory under the Theia config directory on first run and
  on version change, falling back to the read-only directory if the copy fails.

- **AC-9 Language intelligence in the packaged application.** Go-to-definition
  works on a `.ts` file in the installed application, not only in development.

### Slice 5 — Open VSX marketplace

- **AC-10 Extensions view usable.** The Extensions view is reachable and does
  not disturb the default layout applied by `SpexrShellLayoutContribution`,
  which only seeds defaults when the layout state is empty. The left panel
  continues to honour its minimum width for the agent terminal.

- **AC-11 A user-installed language extension delivers intelligence.**
  Installing a language extension from open-vsx.org (for example `golang.Go`
  with `gopls` present) and restarting yields working go-to-definition in that
  language, with the extension installed under the user's Theia extensions
  directory. This is the criterion that answers the original report.

## Risks

- **Installer size.** The builtin tarball is roughly 43 MB compressed and
  measures 196 MB unpacked across 87 plugins. Accepted.
- **Startup time.** The plugin host is an additional forked Node process.
  Measure before and after; the backend already sets `startupTimeout: -1`.
- **UI surface.** Debug, Task, Test, Timeline, Notebook, Search-in-workspace,
  Output and Console appear in menus and the command palette. Accepted, per
  Non-goals.
- **Network dependency at build time.** `theia download:plugins` is idempotent
  and skips files already present, but the first build needs network access. An
  offline CI needs a cached plugin directory.
- **Build cache.** `download:plugins` writes to the workspace root, outside the
  package directory turbo tracks as build output, so it must run as its own
  uncached task rather than inside `build`. Folded into `build`, a warm cache
  would replay the logs, skip the download, and package an application with no
  plugins at all — silently, since `extraResources` copying nothing is not an
  error.
