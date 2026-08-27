export interface SpexrTip {
  readonly id: string;
  readonly category: "spec" | "memory" | "agent" | "workflow" | "shortcut" | "accessibility";
  readonly title: string;
  readonly body: string;
}

export const SPEXR_TIPS: readonly SpexrTip[] = [
  {
    id: "spec-first",
    category: "spec",
    title: "Specs are first-class artifacts",
    body: "Author a spec under specs/ at the workspace root before coding. The agent reads the active spec into its system prompt, so acceptance criteria stay in scope.",
  },
  {
    id: "spec-status",
    category: "spec",
    title: "Spec status drives the workflow",
    body: "Move a spec from draft → ready → in-progress → implemented → validated → shipped. The drift detector checks structural completeness on transition.",
  },
  {
    id: "spec-ac-ids",
    category: "spec",
    title: "Stable acceptance-criteria IDs",
    body: "Use AC-N markers in your spec headings. The agent and the diff reviewer reference them by ID, surviving wording edits.",
  },
  {
    id: "memory-scopes",
    category: "memory",
    title: "Memory has three scopes",
    body: "Baseline (read-only community best-practices), user (personal preferences across projects), project (this repo only). Project overrides user, user overrides baseline.",
  },
  {
    id: "memory-promote",
    category: "memory",
    title: "Promote memory across scopes",
    body: "From the Memory panel, promote a project memory to user scope when a learning generalizes; demote when it turns out to be repo-specific.",
  },
  {
    id: "memory-why",
    category: "memory",
    title: "Always include the Why",
    body: "Feedback memories should lead with the rule, then a Why and How-to-apply. Future-you needs the reason to judge edge cases.",
  },
  {
    id: "memory-no-rot",
    category: "memory",
    title: "Don't memorize what code already says",
    body: "Skip memories about file paths, function names, or current architecture — those are derivable from the repo and rot fast. Memorize intent, not state.",
  },
  {
    id: "agent-auto-start",
    category: "agent",
    title: "The agent auto-starts on workspace open",
    body: "Once a workspace loads, SPEXR builds the system prompt from your effective memory + active spec and opens a Claude session in the left panel.",
  },
  {
    id: "agent-context",
    category: "agent",
    title: "Effective context, not raw context",
    body: "The agent receives the merged effective memory (project > user > baseline) plus the active spec — not every file you have open. Curate memory, not tabs.",
  },
  {
    id: "agent-house-rules",
    category: "agent",
    title: "House rules live in the system prompt",
    body: "SPEXR injects house rules (validation after edits, propose-then-implement, no commits) so behavior is consistent across sessions.",
  },
  {
    id: "workflow-onboarding",
    category: "workflow",
    title: "Run onboarding once per project",
    body: "The wizard captures role, project overview, architecture pointer, conventions, glossary, and runbook — and persists each as a memory record.",
  },
  {
    id: "workflow-baseline",
    category: "workflow",
    title: "Baseline memory is read-only",
    body: "Files under memory/baseline/ ship with the project as community best-practices. Override them by writing project-scope memory of the same name.",
  },
  {
    id: "workflow-drift",
    category: "workflow",
    title: "Drift detector catches gaps",
    body: "On spec save, the structural drift detector flags missing goal sections or empty acceptance criteria before you hand the spec to the agent.",
  },
  {
    id: "workflow-dogfood",
    category: "workflow",
    title: "specs/ and memory/ live at the workspace root",
    body: "Visible folders, not hidden ones — easy to locate from any file manager. Read SPEXR's own folders for live examples.",
  },
  {
    id: "workflow-no-commit",
    category: "workflow",
    title: "Humans handle git",
    body: "The agent never commits or pushes — repo interaction stays with you. Review the diff, then commit when ready.",
  },
  {
    id: "shortcut-agent",
    category: "shortcut",
    title: "⌘⇧A toggles the agent panel",
    body: "Use ctrl/cmd + shift + A to focus the agent chat from anywhere in the IDE.",
  },
  {
    id: "shortcut-spec",
    category: "shortcut",
    title: "⌘⇧S opens the spec panel",
    body: "Quick switch to the active spec with ctrl/cmd + shift + S.",
  },
  {
    id: "shortcut-memory",
    category: "shortcut",
    title: "⌘⇧M opens the memory manager",
    body: "ctrl/cmd + shift + M lists all memories across scopes; edit, promote, or remove from there.",
  },
  {
    id: "shortcut-themes",
    category: "shortcut",
    title: "Switch themes from the command palette",
    body: "Light, Dark, and High-Contrast ship by default. Custom themes plug in via CSS variables — no recompile needed.",
  },
  {
    id: "a11y-keyboard",
    category: "accessibility",
    title: "Every action is keyboard-reachable",
    body: "SPEXR targets WCAG 2.1 AA. If a UI element only responds to mouse, file a bug — it's a regression.",
  },
  {
    id: "a11y-focus",
    category: "accessibility",
    title: "Focus rings are 3:1 contrast",
    body: "The focus indicator uses a dedicated token (--sl-focus-ring) that meets 2.4.11 contrast requirements against every theme surface.",
  },
  {
    id: "a11y-motion",
    category: "accessibility",
    title: "Reduced motion is honored",
    body: "Set prefers-reduced-motion: reduce in your OS — SPEXR collapses transitions to 0ms, no opt-in needed.",
  },
  {
    id: "spec-non-goals",
    category: "spec",
    title: "Non-goals are as important as goals",
    body: "List non-goals explicitly in every spec. They prevent scope creep and signal to the agent what to leave alone.",
  },
  {
    id: "memory-corrections",
    category: "memory",
    title: "Save validations, not just corrections",
    body: "If you accept a non-obvious choice the agent made, save it as a feedback memory. Otherwise the model drifts away from validated patterns.",
  },
  {
    id: "agent-status",
    category: "agent",
    title: "Status badge tells the story",
    body: "Idle, starting, ready, responding, error, ended — the agent header reflects its lifecycle state. Click for details when it's red.",
  },
  {
    id: "workflow-validation",
    category: "workflow",
    title: "Validation runs after every edit",
    body: "Lint, typecheck, and focused tests run automatically on touched files. The agent reports failures; you decide if they're in scope.",
  },
  {
    id: "shortcut-palette",
    category: "shortcut",
    title: "⌘⇧P for the command palette",
    body: "Theia's command palette lists every contributed command, including spexr.* commands for memory and spec operations.",
  },
  {
    id: "memory-index",
    category: "memory",
    title: "MEMORY.md is the index, not a memory",
    body: "MEMORY.md only points to other files. Each memory lives in its own .md with frontmatter. Keep the index under 200 lines.",
  },
  {
    id: "agent-prompt-budget",
    category: "agent",
    title: "Mind the prompt budget",
    body: "Memory files compete for context. Trim verbose entries; the agent rereads them every turn.",
  },
  {
    id: "workflow-spec-pr",
    category: "workflow",
    title: "Spec → plan → tasks → diff → PR",
    body: "The full spexr loop: a spec produces a plan, plans become tasks, tasks land as a diff, the diff opens a PR. Each step is auditable.",
  },
];
