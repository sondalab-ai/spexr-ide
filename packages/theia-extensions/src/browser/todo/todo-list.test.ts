import { describe, expect, it } from "vitest";
import { parseTodo, toggleTodo } from "./todo-list.js";

const FILE = [
  "- [x] Rename sessions on the wall",
  "- [ ] Group subagent sessions under their parent. Transcripts live",
  "  under the parent's folder, and the wall misses them today.",
  "- [ ] Spexr froze after plugging in a monitor, the log said:",
  "2026-09-15T07:05:44Z core INFO Closing channel",
  "2026-09-15T07:06:38Z root ERROR Error: Widget is already attached.",
  "  - [ ] a nested item",
  "",
  "## Later",
  "Some prose that is not an item.",
  "* [X] Star bullets count too",
].join("\n");

describe("parseTodo", () => {
  it("reads every checklist item with its state and the line it starts on", () => {
    const items = parseTodo(FILE);
    expect(items.map((i) => [i.line, i.done, i.title])).toEqual([
      [0, true, "Rename sessions on the wall"],
      [1, false, "Group subagent sessions under their parent. Transcripts live"],
      [3, false, "Spexr froze after plugging in a monitor, the log said:"],
      [6, false, "a nested item"],
      [10, true, "Star bullets count too"],
    ]);
  });

  it("keeps the lines that follow an item as its details, up to the next item or blank line", () => {
    const items = parseTodo(FILE);
    expect(items[1]!.details).toBe("under the parent's folder, and the wall misses them today.");
    expect(items[2]!.details).toBe(
      "2026-09-15T07:05:44Z core INFO Closing channel\n2026-09-15T07:06:38Z root ERROR Error: Widget is already attached.",
    );
    expect(items[0]!.details).toBe("");
  });

  it("reads Windows line endings and an empty file", () => {
    expect(parseTodo("- [ ] one\r\n- [x] two\r\n").map((i) => i.title)).toEqual(["one", "two"]);
    expect(parseTodo("")).toEqual([]);
  });
});

describe("toggleTodo", () => {
  it("flips only the checkbox on that line, leaving the rest of the file as it was", () => {
    const next = toggleTodo(FILE, parseTodo(FILE)[1]!);
    expect(next).toBe(FILE.replace("- [ ] Group subagent", "- [x] Group subagent"));
  });

  it("unticks a done item", () => {
    const next = toggleTodo(FILE, parseTodo(FILE)[0]!);
    expect(next?.startsWith("- [ ] Rename sessions on the wall\n")).toBe(true);
  });

  it("keeps Windows line endings", () => {
    const text = "- [ ] one\r\n- [ ] two\r\n";
    expect(toggleTodo(text, parseTodo(text)[1]!)).toBe("- [ ] one\r\n- [x] two\r\n");
  });

  it("refuses when the line no longer holds that item, because the file changed underneath", () => {
    const item = parseTodo(FILE)[1]!;
    const edited = "- [ ] a new first item\n" + FILE;
    expect(toggleTodo(edited, item)).toBeUndefined();
  });
});
