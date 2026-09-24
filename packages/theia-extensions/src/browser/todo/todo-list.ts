/** One checklist item of a TODO.md. */
export interface TodoItem {
  /** Zero-based line the item's checkbox is on. */
  readonly line: number;
  readonly done: boolean;
  /** The text on the checkbox line. */
  readonly title: string;
  /** The lines that follow it until the next item or a blank line, trimmed. */
  readonly details: string;
  /** The checkbox line exactly as read, so a tick can tell the file changed. */
  readonly raw: string;
}

const ITEM = /^(\s*[-*+]\s+\[)([ xX])(\]\s?)(.*)$/;

/**
 * The checklist items of a TODO.md, in file order. Any `- [ ]`/`- [x]` line
 * (also `*`/`+` bullets, at any indent) starts an item; the lines after it, up
 * to the next item, a blank line or a heading, are its details — which is how
 * a pasted log stays attached to the item that quotes it.
 */
export function parseTodo(text: string): TodoItem[] {
  const lines = text.split(/\r?\n/);
  const items: TodoItem[] = [];
  let current: { item: Omit<TodoItem, "details">; details: string[] } | undefined;
  const flush = (): void => {
    if (current) items.push({ ...current.item, details: current.details.join("\n").trim() });
    current = undefined;
  };
  lines.forEach((raw, line) => {
    const m = ITEM.exec(raw);
    if (m) {
      flush();
      current = { item: { line, done: m[2] !== " ", title: m[4]!.trim(), raw }, details: [] };
      return;
    }
    if (raw.trim() === "" || raw.startsWith("#")) {
      flush();
      return;
    }
    current?.details.push(raw.trim());
  });
  flush();
  return items;
}

/**
 * The file with that item's checkbox flipped, and nothing else changed — not
 * even its line endings. Undefined when the line no longer holds the item as
 * it was read: the file changed since, and writing would clobber that edit.
 */
export function toggleTodo(text: string, item: TodoItem): string | undefined {
  const lines = text.split("\n");
  const at = lines[item.line];
  if (at === undefined) return undefined;
  const cr = at.endsWith("\r") ? "\r" : "";
  const current = cr ? at.slice(0, -1) : at;
  if (current !== item.raw) return undefined;
  const m = ITEM.exec(current);
  if (!m) return undefined;
  lines[item.line] = `${m[1]}${m[2] === " " ? "x" : " "}${m[3]}${m[4]}${cr}`;
  return lines.join("\n");
}
