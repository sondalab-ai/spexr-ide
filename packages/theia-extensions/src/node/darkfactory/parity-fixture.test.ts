import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTranscript } from "./transcript-parser.js";
import { classifySession } from "./session-state.js";
import { buildFollowEvents, type TurnEntry } from "./turns.js";

/**
 * The parity fixture's Claude transcripts (tests/visual/fixtures/claude-sessions,
 * seeded by tests/visual/prepare.ts). A screenshot run is slow and runs only in
 * CI, so these checks hold the fixture to what the wall's own readers make of
 * it before it gets there: a transcript they cannot read, or classify as the
 * demo needs, would show up only as a wrong picture.
 */
const DIR = fileURLToPath(new URL("../../../../../tests/visual/fixtures/claude-sessions/", import.meta.url));
const WS = "/runner/work/_temp/spexr-visual/dark-0/ws/probe-engine";
const SITE = "/runner/work/_temp/spexr-visual/dark-0/ws/prism-site";

interface Manifest {
  file: string;
  project: "ws" | "site";
  sessionId: string;
  name: string;
  ageMinutes: number;
  live: boolean;
  tools: number;
}

const manifest = JSON.parse(readFileSync(DIR + "manifest.json", "utf8")) as Manifest[];

type Entry = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The raw lines, as the run will write them once the two paths are filled in. */
function lines(m: Manifest): string[] {
  const text = readFileSync(DIR + m.file, "utf8").split("{{WS}}").join(WS).split("{{SITE}}").join(SITE);
  return text.split("\n").filter(Boolean);
}
const load = (m: Manifest): Entry[] => lines(m).map((l) => JSON.parse(l) as Entry);
const of = (name: string): Manifest => manifest.find((m) => m.name === name)!;
const blocks = (e: Entry): Entry[] => (Array.isArray(e.message?.content) ? e.message.content : []);
const uses = (entries: Entry[]): Entry[] => entries.flatMap((e) => (e.message?.role === "assistant" ? blocks(e).filter((b) => b.type === "tool_use") : []));
const results = (entries: Entry[]): Entry[] => entries.flatMap((e) => (e.message?.role === "user" ? blocks(e).filter((b) => b.type === "tool_result") : []));
const dirOf = (m: Manifest): string => (m.project === "ws" ? WS : SITE);

describe("parity fixture transcripts", () => {
  it("every line of every transcript is JSON, and none keeps a placeholder", () => {
    for (const m of manifest) {
      expect(lines(m).length).toBeGreaterThan(20);
      for (const line of lines(m)) {
        JSON.parse(line);
        expect(line).not.toContain("{{");
      }
    }
  });

  it("carries the fields a Claude Code interactive transcript has", () => {
    for (const m of manifest) {
      const entries = load(m);
      const messages = entries.filter((e) => e.message);
      expect(entries[0]).toEqual({ type: "mode", mode: "normal", sessionId: m.sessionId });
      expect(entries[1]!.type).toBe("permission-mode");
      let last = 0;
      for (const e of messages) {
        const at = Date.parse(e.timestamp);
        expect(Number.isNaN(at)).toBe(false);
        expect(at).toBeGreaterThanOrEqual(last);
        last = at;
        expect(e.sessionId).toBe(m.sessionId);
        expect(e.cwd).toBe(dirOf(m));
        expect(e.entrypoint).toBe("cli");
        expect(typeof e.uuid).toBe("string");
      }
      for (const e of messages.filter((x) => x.message.role === "assistant")) {
        expect(e.message.model).toMatch(/^claude-opus-/);
        expect(e.message.id).toMatch(/^msg_/);
        expect(typeof e.message.usage.output_tokens).toBe("number");
      }
    }
  });

  it("pairs each tool_result with a tool_use by id; only the live sessions leave one open", () => {
    for (const m of manifest) {
      const entries = load(m);
      const ids = uses(entries).map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
      const answered = results(entries).map((b) => b.tool_use_id);
      for (const id of answered) expect(ids).toContain(id);
      const open = ids.filter((id) => !answered.includes(id));
      expect(open.length).toBe(m.live ? 1 : 0);
      if (m.live) expect(open[0]).toBe(ids[ids.length - 1]);
    }
  });

  it("holds the tool counts the demo shows: 14, and 198 for the other live agent (212 together)", () => {
    for (const m of manifest) expect(uses(load(m)).length).toBe(m.tools);
    expect(of("Refactor the audit").tools + of("Marketing site rebuild").tools).toBe(212);
  });
});

describe("Refactor the audit", () => {
  const entries = load(of("Refactor the audit"));

  it("has an Edit whose structuredPatch is +14 -3, and a failed tool", () => {
    const edits = entries.filter((e) => e.toolUseResult?.structuredPatch);
    const latest = edits[edits.length - 1]!.toolUseResult.structuredPatch as Array<{ lines: string[] }>;
    const all = latest.flatMap((h) => h.lines);
    expect(all.filter((l) => l.startsWith("+")).length).toBe(14);
    expect(all.filter((l) => l.startsWith("-")).length).toBe(3);
    expect(edits[edits.length - 1]!.toolUseResult.filePath).toBe(`${WS}/src/probe/resolve.ts`);
    expect(results(entries).filter((b) => b.is_error === true).length).toBe(1);
  });

  it("times the Bash test at 2.4 s and the Edit at 1.1 s, from the use to its result", () => {
    const at = new Map<string, number>();
    for (const e of entries) for (const b of blocks(e)) if (b.type === "tool_use") at.set(b.id, Date.parse(e.timestamp));
    const took = (name: string, match: string): number => {
      const use = uses(entries).find((b) => b.name === name && JSON.stringify(b.input).includes(match))!;
      const res = entries.find((e) => blocks(e).some((b) => b.type === "tool_result" && b.tool_use_id === use.id))!;
      return Date.parse(res.timestamp) - at.get(use.id)!;
    };
    expect(took("Bash", "pnpm test probe")).toBe(2400);
    expect(took("Edit", "resolve.ts")).toBe(1100);
  });

  it("ends on a TodoWrite with 2 of 3 done, then the unresolved audit", () => {
    const todos = entries.flatMap((e) => (e.toolUseResult?.newTodos ? [e.toolUseResult.newTodos as Array<{ status: string }>] : []));
    expect(todos[todos.length - 1]!.map((t) => t.status)).toEqual(["done", "done", "pending"]);
    const last = uses(entries)[13]!;
    expect(last.name).toBe("Bash");
    expect(last.input.command).toBe("pnpm sl-audit");
  });

  it("answers about 1.2k tokens a second on its last response", () => {
    const final = entries.filter((e) => e.message?.role === "assistant").slice(-2);
    const id = final[1]!.message.id;
    expect(final[0]!.message.id).toBe(id);
    const before = entries.filter((e) => e.message?.role === "user").pop()!;
    const seconds = (Date.parse(final[1]!.timestamp) - Date.parse(before.timestamp)) / 1000;
    const rate = final[1]!.message.usage.output_tokens / seconds;
    expect(rate).toBeGreaterThan(1150);
    expect(rate).toBeLessThan(1250);
  });
});

describe("the wall's own readers on the fixture", () => {
  it("parse each as an interactive session with its goal, cwd and permission mode", () => {
    for (const m of manifest) {
      const p = parseTranscript(lines(m));
      expect(p.interactive).toBe(true);
      expect(p.cwd).toBe(dirOf(m));
      expect(p.gitBranch).toBe("main");
      expect(p.userTurns).toBe(1);
      expect(p.goal.length).toBeGreaterThan(20);
      expect(p.permissionMode).toBe(m.live ? "auto" : "default");
      expect(p.cache?.contextTokens).toBeGreaterThan(0);
    }
  });

  it("render to follow events: prompt, prose, tools, results and an error", () => {
    const events = buildFollowEvents(load(of("Refactor the audit")) as TurnEntry[], 200);
    const kinds = new Set(events.map((e) => e.kind));
    for (const kind of ["prompt", "assistant", "tool", "result", "error"] as const) expect(kinds.has(kind)).toBe(true);
    expect(events[0]!.kind).toBe("prompt");
    expect(events[0]!.text).toContain("cache.write awaited");
    expect(events[events.length - 1]).toEqual({ kind: "tool", text: "pnpm sl-audit" });
  });

  it("classify the two live sessions as working and the others as not working", () => {
    for (const m of manifest) {
      const entries = load(m);
      const p = parseTranscript(lines(m));
      const now = Date.parse("2026-10-09T15:00:00Z");
      const mtime = now - m.ageMinutes * 60_000;
      const live = new Set([WS, SITE]);
      const status = classifySession(dirOf(m), mtime, true, live, now, entries, p.permissionMode);
      expect(status.state === "working").toBe(m.live);
      expect(status.needsYou).toBe(false);
    }
  });

  it("would show a live session needing the user under the default mode: the fixture's auto mode is what keeps the audit working", () => {
    const m = of("Refactor the audit");
    const entries = load(m);
    const now = Date.parse("2026-10-09T15:00:00Z");
    expect(classifySession(WS, now - 5_000, true, new Set([WS]), now, entries, "default").needsYou).toBe(true);
    expect(classifySession(WS, now - 5_000, true, new Set([WS]), now, entries, "auto").state).toBe("working");
  });
});
