/**
 * Routing a task to an expert with the small local model. Asked to pick among
 * expert descriptions, it answered at random (3 of 12 right on a sample set);
 * asked to label the kind of work — with the labels defined in the system
 * prompt — it gets most of them, so the model labels and this table routes.
 */
const LABEL_TO_EXPERT: Readonly<Record<string, string>> = {
  bug: "software-engineering",
  code: "software-engineering",
  review: "review",
  design: "design",
  explore: "brainstorming",
  marketing: "marketing",
  "release-notes": "changelog-writer",
  status: "dri",
};

/**
 * What a label means when the model invents one instead of using the list:
 * checked in order, so the more specific kinds come before `code`.
 */
const SYNONYMS: readonly (readonly [RegExp, string])[] = [
  [/release|changelog/, "release-notes"],
  [/launch|announce|market|post|copy|landing|tweet/, "marketing"],
  [/review/, "review"],
  [/status|progress/, "status"],
  [/explor|idea|option|question/, "explore"],
  [/architect|design/, "design"],
  [/bug|fix|crash|error/, "bug"],
  [/code|feature|implement|refactor|rename|build|add/, "code"],
];

/** How much of a task reaches the model: its first lines carry the intent. */
const TASK_LINES = 6;
const TASK_CHARS = 600;

/** The user prompt: the task to label (the "route" system prompt lists the labels). */
export function buildRoutePrompt(task: string): string {
  const brief = task.split("\n").slice(0, TASK_LINES).join("\n").slice(0, TASK_CHARS).trim();
  return `Task: ${brief}\nLabel:`;
}

/** The expert id for a label, reading an invented label by its words; undefined when unreadable. */
export function expertForLabel(label: string): string | undefined {
  const text = label.toLowerCase().replace(/^label:\s*/, "").replace(/[^a-z -]/g, "").trim();
  const exact = LABEL_TO_EXPERT[text];
  if (exact) return exact;
  const match = SYNONYMS.find(([pattern]) => pattern.test(text));
  return match ? LABEL_TO_EXPERT[match[1]] : undefined;
}

/**
 * The installed expert a model answer routes to, or undefined for no answer,
 * an unreadable one, or a label whose expert is not among the candidates.
 */
export function parseRouteAnswer(answer: string | null, candidates: readonly string[]): string | undefined {
  if (!answer) return undefined;
  const id = expertForLabel(answer);
  return id && candidates.includes(id) ? id : undefined;
}
