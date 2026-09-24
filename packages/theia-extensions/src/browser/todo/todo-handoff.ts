/** A TODO item as handed to the agent. */
export interface TodoHandoff {
  /** The TODO file, relative to its workspace folder. */
  readonly path: string;
  /** Zero-based line of the item's checkbox. */
  readonly line: number;
  readonly title: string;
  readonly details: string;
}

/**
 * The prompt that hands one TODO item to the agent: where it is, what it says,
 * and that the agent ticks it once the work is done — the view picks the tick
 * up from the file, like any other edit.
 */
export function buildTodoHandoff(item: TodoHandoff): string {
  const where = `${item.path}, line ${item.line + 1}`;
  const body = item.details ? `${item.title}\n\n${item.details}` : item.title;
  return [
    `Work on this item from ${where}:`,
    "",
    body,
    "",
    `When it is done, tick it in ${item.path}: change its "- [ ]" to "- [x]" on that line, and nothing else in the file.`,
  ].join("\n");
}
