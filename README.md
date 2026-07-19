<p align="center">
  <img src="apps/desktop/build/icon.png" width="96" alt="SPEXR logo">
</p>

<h1 align="center">SPEXR</h1>
<p align="center"><strong>Agent-centric, spec-based IDE.</strong><br>Built on Eclipse Theia + Theia AI, fully TypeScript.</p>

<p align="center">
  <a href="https://github.com/marcellobarile/spexr-ide/releases"><img src="https://img.shields.io/github/v/release/marcellobarile/spexr-ide?label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platforms">
</p>

> **Status: v0.1.3 — public beta.** Packaged installers available on the [Releases page](https://github.com/marcellobarile/spexr-ide/releases). Core spec workflow complete. On-disk formats stable; minor API changes possible before 1.0.

## Contents

- [Why](#why)
- [Pillars](#pillars)
- [Screenshots](#screenshots)
- [For adopters](#for-adopters)
- [For contributors](#for-contributors)
- [License](#license)

## Why

Most editors bolt an agent into a sidebar. SPEXR inverts the layout: the Claude session is the primary surface, source files and terminals orbit around it. Specs are first-class artifacts — every change traces back to an acceptance criterion.

## Pillars

1. **Agent-primary shell** — a Claude session starts on workspace open and is the main surface, not a panel.
2. **Spec-driven flow** — `docs/specs/<NNNN-slug>.md` → plan → tasks → diff → PR. A drift detector flags divergence.
3. **Two-scope memory** — `~/.spexr/memory/` (user) + `<workspace>/docs/memory/` (project). Frontmatter-tagged markdown, indexed in `MEMORY.md`. Promote/demote between scopes.
4. **Onboarding wizard** — first session asks for internal docs (architecture, conventions, glossary, runbooks); answers become memory.
5. **Community best-practices baseline** — language/framework guidance pre-loaded, override-able per scope.
6. **Themeable, accessible UI** — WCAG 2.1 AA via Radix primitives + design tokens (CSS vars). Light, dark, high-contrast presets + custom JSON themes.
7. **Smart search** — sidebar panel ranks results with hybrid BM25 + dense embeddings, expands queries, and extracts symbols across languages. A local model generates one-line file descriptions on first index — no API calls, no data leaves the machine.
8. **Git, built in** — full SCM provider (stage/unstage/commit/push/pull/fetch/branch/checkout) plus inline blame, no external Git extension needed.
9. **Darkfactory** — a wall of every local Claude session across all your config dirs (`~/.claude`, aliased profiles, …): live state (working / waiting on you / idle), an on-device AI summary of each, and one-click open into an embedded terminal that resumes the session in place — read-only follow when it's live elsewhere, `--fork-session` to take over. Watch and drive many agents from one window.

> **On `main`, not yet released.** Smart search, Git support, and Darkfactory are merged but not in a tagged version yet — build from source (below) to try them before the next installer release.

## Screenshots

> Pre-alpha UI — these might change.

**Welcome**

![Welcome screen](docs/screenshots/welcome.png)

**Specs + agent**

![A spec open with the agent terminal on the left](docs/screenshots/specs-agent.png)

**Memory**

![Project & user memory panel](docs/screenshots/memory.png)

**Experts**

![Expert personas marketplace](docs/screenshots/experts.png)

**Smart search**

![Smart search sidebar with hybrid results, categories, and AI-generated descriptions](docs/screenshots/smart-search.png)

---

## For adopters

### Requirements

| Requirement | Notes |
|---|---|
| **Claude Code CLI installed & authenticated** | **Hard dependency.** SPEXR does not call the Anthropic API directly — it spawns your locally installed `claude` binary and reuses its stored credentials (`~/.claude`). No `ANTHROPIC_API_KEY` is read. A missing or ambiguous binary is a blocking error. |
| Node.js ≥ 22.17.0 | `.nvmrc` pins the dev version; `nvm use` picks it up. |
| pnpm ≥ 9 | `corepack enable` is enough; the repo pins `pnpm@9.12.0`. |
| Git | Required for the spec → diff → PR flow. |

Verify the CLI before launching SPEXR:

```bash
claude --version     # must resolve on your PATH (or set spexr.claude.executablePath)
```

If you launch `claude` through a shell alias that sets `CLAUDE_CONFIG_DIR` (e.g. multiple Claude profiles), SPEXR detects it on workspace open and, when more than one profile exists, prompts once per project and remembers your choice.

### Install from a release (recommended)

Download the latest installer from the [Releases page](https://github.com/marcellobarile/spexr-ide/releases).

#### macOS

1. Download `SPEXR-<version>-mac-arm64.dmg` (Apple Silicon) or `SPEXR-<version>-mac-x64.dmg` (Intel).
2. Open the DMG and drag **SPEXR** to **Applications**.
3. **First launch only:** macOS blocks unsigned apps. Right-click the app icon → **Open** → **Open** in the dialog. After that, double-click works normally.

> SPEXR is not yet notarized by Apple. The "right-click → Open" step is a one-time workaround until code signing is set up.

#### Windows

1. Download `SPEXR-<version>-win-x64.exe` (NSIS installer).
2. Run the installer. If Windows SmartScreen warns "Unknown publisher", click **More info → Run anyway**.
3. SPEXR appears in the Start menu.

> Windows may show a SmartScreen warning because the binary is not yet code-signed.

#### Linux

**AppImage (any distro):**
```bash
chmod +x SPEXR-<version>-linux-x64.AppImage
./SPEXR-<version>-linux-x64.AppImage
```

**Debian / Ubuntu:**
```bash
sudo dpkg -i SPEXR-<version>-linux-x64.deb
# then launch via Applications menu or:
spexr
```

---

### Run from source

Requires Node.js ≥ 22.17.0 and pnpm ≥ 9.

```bash
nvm use
pnpm setup        # installs deps, rebuilds Electron native modules, builds packages
pnpm dev          # build + launch
```

On first launch the onboarding wizard seeds project memory. Open any folder as your workspace; the Claude session starts automatically.

### Build installers locally

```bash
pnpm package           # current OS
pnpm package:mac       # dmg + zip (x64 + arm64)  — requires macOS
pnpm package:win       # nsis + zip (x64)          — requires Windows or Wine
pnpm package:linux     # AppImage + deb (x64)
```

Output: `apps/desktop/dist-installers/`. Config: `apps/desktop/electron-builder.yml`.

### How your workspace is laid out

SPEXR writes spec and memory files under a `docs/` container at the workspace root, grouped and away from source folders:

```
<your-workspace>/
└── docs/
    ├── agents/           Installed expert personas (<id>.md)
    ├── memory/           Project-scope memory (markdown + MEMORY.md index)
    └── specs/            NNNN-<slug>.md spec files
        └── .context/     Per-spec supporting material
            └── <NNNN-slug>/
                ├── _links.md         External URLs (briefings, docs, references)
                └── <copied-files>    Local files copied as context
```

User-scope memory stays under `~/.spexr/memory/`.

> **Naming collision, accepted trade-off:** if your project already uses `docs/specs/` or `docs/memory/` for something else, SPEXR writes into the existing folder rather than creating a separate namespace. Rename your folders or pre-seed SPEXR's files if you need both.

### Spec context

Each spec can carry its own knowledge base — kickoff briefs, customer feedback, design notes, reference URLs — kept separate from the spec body, under `docs/specs/.context/<NNNN-slug>/`.

- **From the Spec view** — open a spec; the tab toolbar exposes:
  - **Send to agent** (rocket icon) — hands the spec body to the Claude session.
  - **Add context** (library icon) — quick pick:
    - *From file…* — copies one or more local files into `.context/<slug>/`. Filename collisions get a `-2`, `-3` suffix.
    - *From URL…* — appends `- [label](url) — YYYY-MM-DD` to `.context/<slug>/_links.md`.
- **From the Spec list panel** — every spec offers *Send to agent* (primary) and *Open* (secondary).

Context is storage-only for now: files and links sit next to the spec, ready for the agent to load on a future handoff.

---

## For contributors

### Repository layout

```
SPEXR/
├── apps/
│   └── desktop/          Electron shell (Theia) — no source, only DI wiring & packaging
├── packages/
│   ├── core/             DI, config, logger, paths
│   ├── ui-kit/           Design tokens, themes, Radix wrappers
│   ├── memory/           Scope manager, markdown index
│   ├── spec/             Spec parser, plan/task pipeline, drift detector
│   ├── agent/            Claude session lifecycle, prompt builder, expert catalog (Theia-agnostic)
│   ├── onboarding/       Wizard state machine
│   └── theia-extensions/ Theia binding: src/node backend + src/browser frontend proxy
└── docs/
    ├── memory/           Project-scope memory (dogfood, flat layout)
    └── specs/            Specs as first-class artifacts (NNNN-<slug>.md)
```

**Architecture rule:** `@spexr/agent` (and the other `packages/*`) stay Theia-agnostic. All Theia DI bindings live in `@spexr/theia-extensions`; `apps/desktop` carries no business logic. The agent runs in the Theia backend (node) and streams to the frontend over JSON-RPC.

### Stack

- TypeScript strict
- Eclipse Theia + Theia AI
- React (provided by Theia) + Radix UI primitives + Tailwind
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), wired to the **local Claude Code CLI** as its transport
- pnpm workspaces + Turborepo
- Vitest, ESLint flat, Prettier

### Dev loop

```bash
pnpm dev:watch    # seed a build, then run every package watcher (tsc) + webpack bundle watcher + Electron together; Ctrl+C stops all
```

- **Frontend / command / UI changes** → after watchers rebuild `lib/` and re-bundle, reload the window (`Cmd/Ctrl+R`). No restart.
- **Backend / `electron-main` changes** → restart (`pnpm dev:watch`); Electron has no backend hot-reload.

Other commands:

```bash
pnpm build        # build all packages (turbo)
pnpm start        # launch Electron against the current build
pnpm lint         # ESLint, all packages
pnpm typecheck    # tsc --noEmit, all packages
pnpm test         # Vitest, all packages
pnpm format       # Prettier write
```

DevTools are off by default. To open the Electron DevTools on each window:

```bash
SPEXR_DEVTOOLS=1 pnpm start
```

### Localization

UI strings go through Theia's i18n: `nls.localize("spexr/<area>/<key>", "English default", ...args)`. **English is the default** and renders with no language pack — the second argument is the fallback. No other languages ship today; add one by registering a Theia `LocalizationContribution` (backend) for the existing `spexr/*` keys — call sites don't change.

### Release process

Releases are fully automated via GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)). The script handles versioning, changelog, and tagging; CI handles building and publishing.

#### Cutting a release

```bash
bash scripts/release.sh [patch|minor|major]
# default: patch  →  0.1.0 → 0.1.1
```

What it does:

1. Validates the working tree is clean and the branch is `main`.
2. Bumps `version` in `apps/desktop/package.json` and root `package.json`.
3. Generates a changelog section from `git log` since the last tag (merges and `chore: release` commits excluded).
4. Prepends the section to `CHANGELOG.md`.
5. Commits `chore: release v<new-version>`.
6. Creates an annotated tag `v<new-version>`.
7. Pushes commit + tag → triggers CI.

After cutting a release, sync the in-app "What's new" splash to the new changelog entry:

```bash
pnpm sync:release-notes
```

This regenerates `packages/theia-extensions/src/browser/release-notes.ts` from `CHANGELOG.md` — edit the changelog, not the generated file.

#### What CI does on a `v*` tag

```
tag push
  └─ e2e         build:dev + Playwright on ubuntu + xvfb
       └─ build  [mac | win | linux] production builds (parallel, needs e2e)
            └─ release  GitHub Release + installer attachments (needs all builds)
```

| Job | Runner | Artifacts |
|---|---|---|
| `e2e` | `ubuntu-latest` | Playwright HTML report (on failure, 7-day retention) |
| `build / mac` | `macos-latest` | `SPEXR-<v>-mac-{x64,arm64}.{dmg,zip}` |
| `build / win` | `windows-latest` | `SPEXR-<v>-win-x64.{exe,zip}` |
| `build / linux` | `ubuntu-latest` | `SPEXR-<v>-linux-x64.{AppImage,deb}` |
| `release` | `ubuntu-latest` | GitHub Release (auto-created, changelog body) |

The E2E job is a hard gate: if any Playwright test fails the build and release jobs do not run.

#### Code signing (current state)

| Platform | Status | Notes |
|---|---|---|
| macOS | **Unsigned** | `CSC_IDENTITY_AUTO_DISCOVERY: false` in CI. Users must right-click → Open on first launch. Add `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID` to repo secrets to enable notarized builds. |
| Windows | **Unsigned** | SmartScreen warns on first run. Add an EV certificate secret to enable signing. |
| Linux | N/A | No signing required for AppImage/deb. |

#### Running E2E locally

```bash
# Requires a dev build first
pnpm build:dev

# Mac / Windows (no display server needed)
pnpm --filter @spexr/e2e test

# Linux (needs xvfb)
xvfb-run --auto-servernum pnpm --filter @spexr/e2e test

# Interactive UI mode
pnpm --filter @spexr/e2e test:ui
```

Playwright HTML report opens at `tests/e2e/playwright-report/index.html` after a run.

### Contributing workflow

SPEXR dogfoods its own spec-driven flow:

1. **Start from a spec.** Add or pick one in `docs/specs/NNNN-<slug>.md` with frontmatter (`slug`, `title`, `status`, `createdAt`) and **acceptance criteria** (`AC-N`). Every change traces back to an AC.
2. **Branch** off the default branch — never commit to it directly.
3. **Implement** in the right package; keep `packages/*` Theia-agnostic and Theia bindings in `@spexr/theia-extensions`.
4. **Validate** before review: `pnpm lint && pnpm typecheck && pnpm test`. Bug fixes get a regression test; tricky logic gets tests first.
5. **Keep specs honest.** When behavior supersedes an AC, mark it (strike-through + pointer to the new AC) rather than deleting history — see `docs/specs/0002-agent-transport.md`.
6. **Open a PR** against the AC it satisfies. Humans handle commits and merges.

Conventions: TypeScript strict, no dead code or speculative abstractions, comments only for non-obvious *why*, follow the surrounding style (`.editorconfig` + `.prettierrc.json` are authoritative). `pnpm format` before pushing.

---

## License

MIT. See [`LICENSE`](LICENSE).
