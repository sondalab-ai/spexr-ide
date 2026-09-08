import { describe, expect, it } from "vitest";
import { openTerminalAt, type DockShellLike, type TerminalOpenerLike } from "./project-terminal-open.js";
import { terminalKindOf } from "./terminal-style.js";

function makeHarness(): {
  terminals: TerminalOpenerLike;
  shell: DockShellLike;
  created: Record<string, unknown>[];
  added: { id: string; area: string }[];
  activated: string[];
  started: string[];
} {
  const created: Record<string, unknown>[] = [];
  const added: { id: string; area: string }[] = [];
  const activated: string[] = [];
  const started: string[] = [];
  return {
    created,
    added,
    activated,
    started,
    terminals: {
      newTerminal: async (options) => {
        created.push(options);
        const id = `terminal-${created.length}`;
        return { id, start: async () => void started.push(id) };
      },
    },
    shell: {
      addWidget: async (widget, options) => void added.push({ id: widget.id, area: options.area }),
      activateWidget: async (id) => void activated.push(id),
    },
  };
}

describe("openTerminalAt", () => {
  it("starts a terminal in the directory, docks it in the bottom panel and focuses it", async () => {
    const h = makeHarness();
    await openTerminalAt(h.terminals, h.shell, "/Users/x/proj", "proj");
    expect(h.created).toHaveLength(1);
    expect(h.created[0]).toMatchObject({
      cwd: "/Users/x/proj",
      title: "proj",
      useServerTitle: false,
    });
    expect(h.started).toEqual(["terminal-1"]);
    expect(h.added).toEqual([{ id: "terminal-1", area: "bottom" }]);
    expect(h.activated).toEqual(["terminal-1"]);
  });

  it("carries the directory as cwd, so no text is ever sent into a shell", async () => {
    const h = makeHarness();
    await openTerminalAt(h.terminals, h.shell, "/Users/x/proj", "proj");
    // The options are the whole instruction: nothing here is a command to type.
    expect(Object.keys(h.created[0]!)).toEqual(["title", "useServerTitle", "iconClass", "cwd"]);
  });

  it("leaves the terminal unmarked, so it is styled as an ordinary Theia terminal", async () => {
    const h = makeHarness();
    await openTerminalAt(h.terminals, h.shell, "/Users/x/proj", "proj");
    expect(terminalKindOf(h.created[0]!.kind as string | undefined)).toBe("editor");
  });

  it("does nothing without a directory to open at", async () => {
    const h = makeHarness();
    await openTerminalAt(h.terminals, h.shell, "", "proj");
    expect(h.created).toHaveLength(0);
    expect(h.added).toHaveLength(0);
  });
});
