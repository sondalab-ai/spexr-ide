import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { planByReveal, sendByPaste, type SendPorts } from "./agent-pane-send.js";
import { bracketedPaste } from "../../common/terminal-paste.js";

/** A terminal that records every call; there is no method that could press a key. */
function fake(over: Partial<{ trusted: boolean; running: boolean; startsRunning: boolean }> = {}): { ports: SendPorts; log: string[] } {
  const log: string[] = [];
  let running = over.running ?? true;
  const ports: SendPorts = {
    trusted: async () => over.trusted ?? true,
    running: () => running,
    start: async () => {
      log.push("start");
      running = over.startsRunning ?? true;
    },
    ready: async () => void log.push("ready"),
    paste: (t) => void log.push(`paste:${JSON.stringify(t)}`),
    reveal: async () => void log.push("reveal"),
  };
  return { ports, log };
}

describe("sendByPaste", () => {
  it("pastes into a running agent, then brings its terminal forward", async () => {
    const { ports, log } = fake();
    expect(await sendByPaste("fix it", ports)).toBe("pasted");
    expect(log).toEqual(['paste:"fix it"', "reveal"]);
  });

  it("pastes the first prompt of a fresh session (and says it was pasted into a fresh launch, so the draft is kept): it starts the agent, waits for it, and asks nothing of a transcript that does not exist yet", async () => {
    const { ports, log } = fake({ running: false });
    expect(await sendByPaste("first words", ports)).toBe("pasted-after-start");
    expect(log).toEqual(["start", "ready", 'paste:"first words"', "reveal"]);
  });

  it("does not look at what the agent is doing: a working or waiting agent is pasted to like an idle one", async () => {
    expect(Object.keys(fake().ports)).toEqual(["trusted", "running", "start", "ready", "paste", "reveal"]);
  });

  it("does nothing in an untrusted workspace: no launch, no paste", async () => {
    for (const running of [true, false]) {
      const { ports, log } = fake({ trusted: false, running });
      expect(await sendByPaste("x", ports)).toBe("untrusted");
      expect(log).toEqual([]);
    }
  });

  it("pastes nothing when the agent could not be started", async () => {
    const { ports, log } = fake({ running: false, startsRunning: false });
    expect(await sendByPaste("x", ports)).toBe("not-started");
    expect(log).toEqual(["start"]);
  });
});

describe("planByReveal", () => {
  it("brings the running agent's terminal forward and types nothing", async () => {
    const { ports, log } = fake();
    expect(await planByReveal(ports)).toBe("revealed");
    expect(log).toEqual(["reveal"]);
  });

  it("does nothing without trust, or with no agent running", async () => {
    expect(await planByReveal(fake({ trusted: false }).ports)).toBe("untrusted");
    expect(await planByReveal(fake({ running: false }).ports)).toBe("not-running");
  });
});

// The composer never writes a key. The terminal API it uses is the paste, which the manager brackets itself.
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const code = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the composer never presses Enter or Shift+Tab", () => {
  it("has no Enter, Shift+Tab or key-sending call in the pane's sources", () => {
    for (const file of ["./agent-pane-widget.tsx", "./agent-pane-composer-model.ts", "./agent-pane-send.ts", "./agent-pane-composer.tsx"]) {
      const src = code(file);
      expect(src, file).not.toMatch(/submitAgentInput|cycleAgentMode|SHIFT_TAB|guardedSend|guardedPlanToggle/);
      expect(src, file).not.toMatch(/["'`]\\r["'`]|\\x1b\[Z|\\u001b\[Z|sendText\(/);
    }
  });

  it("gives the agent terminal one input call, the paste, written with explicit brackets and no Enter after it", () => {
    const manager = code("../agent/claude-terminal-manager.ts");
    expect(manager).toMatch(/pasteIntoAgent\(text: string\): void \{\s*this\.agentTerminal\(\)\.sendText\(bracketedPaste\(text\)\);/);
    expect(manager).not.toMatch(/submitAgentInput|cycleAgentMode|SHIFT_TAB/);
    expect(bracketedPaste("x")).toBe("\x1b[200~x\x1b[201~");
  });
});

describe("a reflex second Enter", () => {
  it("is ignored while the key repeats, and the terminal takes focus only after a pause when the send was a keystroke", () => {
    const composer = code("./agent-pane-composer.tsx");
    expect(composer).toMatch(/if \(e\.repeat\) return;[\s\S]*?p\.onSend\(true\)/);
    expect(composer).toMatch(/p\.onSend\(false\)/);
    const widget = code("./agent-pane-widget.tsx");
    expect(widget).toMatch(/KEYBOARD_REVEAL_DELAY_MS = 400/);
    expect(widget).toMatch(/viaKeyboard \? KEYBOARD_REVEAL_DELAY_MS : 0/);
  });

  it("keeps the draft after a paste into a fresh launch, and clears it only after a paste into a running agent", () => {
    const widget = code("./agent-pane-widget.tsx");
    expect(widget).toMatch(/if \(outcome === "pasted"\) this\.drafts\.clearIfUnchanged\(sent\)/);
  });
});
