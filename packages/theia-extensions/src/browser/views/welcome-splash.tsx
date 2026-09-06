import * as React from "react";
import { Tip } from "@spexr/ui-kit";
import type { ReleaseNote } from "../../common/changelog.js";
import { httpsHref } from "./external-link.js";

export interface WelcomeSplashProps {
  readonly onNewProject: () => void;
  readonly onOpenFolder: () => void;
  readonly onFocusAgent: () => void;
  /** True when a workspace is open but has no specs yet. */
  readonly emptyProject?: boolean;
  readonly onStartFirstSpec?: () => void;
  /** Latest release note to show in the "What's new" panel. */
  readonly releaseNote?: ReleaseNote | undefined;
}

interface ActionCard {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly shortcut?: string;
  readonly onClick: () => void;
  readonly primary?: boolean;
}

interface WorkflowStep {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

const WORKFLOW_STEPS: readonly WorkflowStep[] = [
  {
    id: "initialize",
    label: "Initialize",
    description:
      "Open or create a workspace. The onboarding wizard captures role, conventions, glossary, and runbooks into memory — your project constitution.",
  },
  {
    id: "specify",
    label: "Specify",
    description:
      "Author specs/NNNN-<slug>.md with goal, non-goals, and acceptance criteria. The spec is the contract; everything else is derived.",
  },
  {
    id: "context",
    label: "Add context",
    description:
      "From the spec toolbar, attach reference files and URLs. They land under docs/specs/.context/<slug>/ ready for the agent to load.",
  },
  {
    id: "clarify",
    label: "Clarify",
    description:
      "Hand the spec to the agent and resolve open AC questions in chat before planning. Ambiguity caught here is cheap; caught after implementation, it isn't.",
  },
  {
    id: "plan",
    label: "Plan & tasks",
    description:
      "Ask the agent to draft a plan: numbered steps, each linked to the acceptance criteria it covers. Steps decompose into trackable tasks.",
  },
  {
    id: "implement",
    label: "Implement & validate",
    description:
      "Agent edits, you review the diff. Drift detector and tests check coverage against the AC — divergence is flagged before merge.",
  },
  {
    id: "ship",
    label: "Ship",
    description:
      "Open a PR with a Spec: <slug> trailer so the change traces back to its acceptance criterion. Memory carries the context into the next spec.",
  },
];

const WHATS_NEW_STORAGE_KEY = "spexr.whatsNewDismissed";

function renderInline(text: string): React.ReactNode {
  const result: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) result.push(text.slice(last, m.index));
    const href = httpsHref(m[2]!);
    result.push(
      href ? (
        <a key={m.index} href={href} target="_blank" rel="noopener noreferrer">
          {m[1]}
        </a>
      ) : (
        m[1]
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) result.push(text.slice(last));
  return result.length === 1 ? result[0] : result;
}

const WhatsNewPanel: React.FC<{ note: ReleaseNote }> = ({ note }) => {
  const [dismissed, setDismissed] = React.useState(() => {
    try {
      return localStorage.getItem(WHATS_NEW_STORAGE_KEY) === note.version;
    } catch {
      return false;
    }
  });

  const dismiss = React.useCallback(() => {
    try {
      localStorage.setItem(WHATS_NEW_STORAGE_KEY, note.version);
    } catch {}
    setDismissed(true);
  }, [note.version]);

  if (dismissed) return null;

  return (
    <section className="spexr-whats-new" aria-labelledby="spexr-whats-new-title">
      <div className="spexr-whats-new__head">
        <div>
          <p className="spexr-whats-new__eyebrow">What&rsquo;s new &mdash; v{note.version}</p>
          {note.tagline && (
            <h2 id="spexr-whats-new-title" className="spexr-whats-new__title">
              {note.tagline}
            </h2>
          )}
        </div>
        <button type="button" className="spexr-whats-new__dismiss" onClick={dismiss}>
          Dismiss
        </button>
      </div>
      <ul className="spexr-whats-new__list">
        {note.changes.map((change, i) => (
          <li key={i} className="spexr-whats-new__item">
            {renderInline(change)}
          </li>
        ))}
      </ul>
    </section>
  );
};

export const WelcomeSplash: React.FC<WelcomeSplashProps> = ({
  onNewProject,
  onOpenFolder,
  onFocusAgent,
  emptyProject,
  onStartFirstSpec,
  releaseNote,
}) => {
  const startFirstSpec: readonly ActionCard[] =
    emptyProject && onStartFirstSpec
      ? [
          {
            id: "first-spec",
            title: "Start with the first spec",
            description:
              "This project has no specs yet. Create docs/specs/0001-<slug>.md and begin the workflow.",
            onClick: onStartFirstSpec,
            primary: true,
          },
        ]
      : [];

  const cards: readonly ActionCard[] = [
    ...startFirstSpec,
    {
      id: "new",
      title: "New project",
      description: "Start a fresh workspace. SPEXR seeds docs/memory/ and docs/specs/ at the root.",
      onClick: onNewProject,
      primary: startFirstSpec.length === 0,
    },
    {
      id: "open-folder",
      title: "Open folder",
      description: "Open an existing repository as a workspace.",
      onClick: onOpenFolder,
    },
    {
      id: "agent",
      title: "Talk to the agent",
      description: "Focus the Claude session in the left panel and start a conversation.",
      shortcut: "⌘⇧A",
      onClick: onFocusAgent,
    },
  ];

  return (
    <div className="spexr-welcome">
      <header className="spexr-welcome__header">
        <p className="spexr-welcome__eyebrow">SPEXR</p>
        <h1 className="spexr-welcome__title">Spec-based development, agent-first.</h1>
        <p className="spexr-welcome__subtitle">
          Author a spec, let the agent draft a plan, review the diff, ship the PR. Memory persists
          across sessions — your context, your conventions, always loaded.
        </p>
      </header>

      <section className="spexr-welcome__actions" aria-label="Get started">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            className={`spexr-welcome-card ${card.primary ? "spexr-welcome-card--primary" : ""}`}
            onClick={card.onClick}
          >
            <span className="spexr-welcome-card__title">{card.title}</span>
            <span className="spexr-welcome-card__desc">{card.description}</span>
            {card.shortcut ? (
              <span className="spexr-welcome-card__kbd" aria-hidden>
                {card.shortcut}
              </span>
            ) : null}
          </button>
        ))}
      </section>

      <section className="spexr-welcome__workflow" aria-labelledby="spexr-welcome-workflow-title">
        <header className="spexr-welcome__section-head">
          <h2 id="spexr-welcome-workflow-title" className="spexr-welcome__section-title">
            Typical workflow
          </h2>
          <p className="spexr-welcome__section-sub">
            Seven phases from blank repo to merged PR. Each phase maps to a SPEXR surface — no
            scripts to memorize.
          </p>
        </header>
        <ol className="spexr-workflow">
          {WORKFLOW_STEPS.map((step, index) => (
            <li key={step.id} className="spexr-workflow__item">
              <span className="spexr-workflow__index" aria-hidden>
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="spexr-workflow__body">
                <span className="spexr-workflow__label">{step.label}</span>
                <span className="spexr-workflow__desc">{step.description}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {releaseNote ? <WhatsNewPanel note={releaseNote} /> : null}

      <footer className="spexr-welcome__footer">
        <Tip />
      </footer>
    </div>
  );
};
