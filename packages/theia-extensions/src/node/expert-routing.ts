/** An expert the local model may route a task to. */
export interface ExpertCandidate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/** How much of a task reaches the model: its first lines carry the intent. */
const TASK_LINES = 6;
const TASK_CHARS = 600;

/**
 * The user prompt for routing a task to one expert (the "route" kind's system
 * prompt says to answer with an id or `none`). Candidates are listed by id, the
 * token the answer must reproduce, with their one-line description.
 */
export function buildRoutePrompt(task: string, candidates: readonly ExpertCandidate[]): string {
  const brief = task.split("\n").slice(0, TASK_LINES).join("\n").slice(0, TASK_CHARS).trim();
  const list = candidates.map((c) => `- ${c.id}: ${c.description}`).join("\n");
  return `Experts:\n${list}\n\nTask: ${brief}`;
}

/**
 * The expert id a model answer names, or undefined for `none`, no answer, an
 * id that is not a candidate, or an answer that names several. A small model
 * wraps its answer in quotes, backticks, "Answer:" or a full stop, and may give
 * the display name instead of the id; all of that is accepted.
 */
export function parseRouteAnswer(
  answer: string | null,
  candidates: readonly ExpertCandidate[],
): string | undefined {
  if (!answer) return undefined;
  const text = answer.toLowerCase();
  const named = candidates.filter((c) => {
    const id = c.id.toLowerCase();
    const name = c.name.toLowerCase();
    return new RegExp(`(^|[^a-z0-9-])${escape(id)}($|[^a-z0-9-])`).test(text) || text.includes(name);
  });
  return named.length === 1 ? named[0]!.id : undefined;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
