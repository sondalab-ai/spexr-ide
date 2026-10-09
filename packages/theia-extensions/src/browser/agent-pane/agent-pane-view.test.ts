import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentPaneView } from "./agent-pane-view.js";
import type { AgentPaneSnapshot, PaneTool } from "../../common/agent-pane-protocol.js";

const noop = (): void => undefined;
const render = (snapshot: AgentPaneSnapshot | undefined, expanded = false): string =>
  renderToStaticMarkup(React.createElement(AgentPaneView, { snapshot, expanded, onToggleExpanded: noop, onReveal: noop }));
const tools = (n: number): PaneTool[] => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, verb: "Read", target: `f${i}.ts`, state: "done" as const, durationMs: 200 }));
const SESSION = "8f2a4c1e-3b7d-4e52-9a61-0c5d2e8b7f13";

describe("AgentPaneView", () => {
  it("shows an empty state, with a way to the terminal, when there is no snapshot", () => {
    const html = render(undefined);
    expect(html).toContain("spexr-agent-pane--empty");
    expect(html).toContain("No session yet");
    expect(html).toContain("Open the agent terminal");
    expect(html).not.toContain("spexr-agent-tool");
  });

  it("shows the head from a snapshot with no turn at all: the id, the placeholder title, no tag", () => {
    const html = render({ sessionId: SESSION });
    expect(html).toContain("Agent · 8f2a4c");
    expect(html).toContain("New session");
    expect(html).not.toContain("spexr-agent-pane__model");
    expect(html).not.toContain("spexr-agent-tools");
    expect(html).not.toContain("spexr-agent-prompt");
    expect(html).not.toContain("spexr-agent-needs");
  });

  it("shows the model family as a tag and the session's name as the title", () => {
    const html = render({ sessionId: SESSION, title: "Refactor the audit", model: "claude-opus-5-5" });
    expect(html).toContain("Refactor the audit");
    expect(html).toMatch(/class="sl-tag spexr-agent-pane__model">Opus</);
  });

  it("shows the waiting-for-you row, with Reveal, only when the agent needs the user", () => {
    expect(render({ sessionId: SESSION })).not.toContain("Waiting for you in the terminal");
    const html = render({ sessionId: SESSION, needsYou: true });
    expect(html).toContain("Waiting for you in the terminal");
    expect(html).toMatch(/<button[^>]*>Reveal<\/button>/);
  });

  it("folds all but the last four rows behind a button that says how many, and its aria-expanded follows the state", () => {
    const snapshot: AgentPaneSnapshot = { sessionId: SESSION, turn: { tools: tools(11) } };
    const folded = render(snapshot, false);
    expect(folded.match(/class="spexr-agent-tool"/g)).toHaveLength(4);
    expect(folded).toMatch(/aria-expanded="false"[^>]*>7 earlier</);
    expect(folded).toContain("f10.ts");
    expect(folded).not.toContain("f0.ts");
    const open = render(snapshot, true);
    expect(open.match(/class="spexr-agent-tool"/g)).toHaveLength(11);
    expect(open).toMatch(/aria-expanded="true"[^>]*>7 earlier</);
  });

  it("has no fold when every row is shown", () => {
    const html = render({ sessionId: SESSION, turn: { tools: tools(4) } });
    expect(html).not.toContain("spexr-agent-tools__fold");
    expect(html.match(/class="spexr-agent-tool"/g)).toHaveLength(4);
  });

  it("marks a running tool and a failed one by state and by word, not by colour alone", () => {
    const html = render({
      sessionId: SESSION,
      turn: { tools: [{ id: "a", verb: "Run", target: "pnpm test", state: "run" }, { id: "b", verb: "Run", target: "rg x", state: "error" }] },
    });
    expect(html).toMatch(/data-state="run"[\s\S]*?>running</);
    expect(html).toMatch(/data-state="error"[\s\S]*?>failed</);
  });

  it("shows an edit's size outside the cut text, and the full path as the row's title", () => {
    const html = render({ sessionId: SESSION, turn: { tools: [{ id: "a", verb: "Edit", target: "resolve.ts", path: "src/probe/resolve.ts", state: "done", added: 14, removed: 3 }] } });
    expect(html).toContain('title="src/probe/resolve.ts"');
    expect(html).toMatch(/<\/span><span class="spexr-agent-stat"><i>\+14<\/i> <s>−3<\/s><\/span>/);
  });

  it("reads a search pattern without its regex escapes, and sets backtick spans as inline code", () => {
    const html = render({ sessionId: SESSION, turn: { prose: ["Make `cache.write` awaited"], tools: [{ id: "a", verb: "Search", target: "cache\\.write", state: "done" }] } });
    expect(html).toContain("<b class=\"spexr-agent-tool__target\"> cache.write</b>");
    expect(html).toContain('<code class="sl-code">cache.write</code>');
  });

  it("gives the tool list and the plan accessible names, and the plan list semantics", () => {
    const html = render({ sessionId: SESSION, turn: { tools: tools(2) }, plan: [{ text: "One", done: true }, { text: "Two", done: false }] });
    expect(html).toContain('aria-label="Tool calls"');
    expect(html).toMatch(/<ul[^>]*aria-labelledby="[^"]+"/);
    expect(html.match(/<li class="spexr-agent-plan__item">/g)).toHaveLength(2);
    expect(html).toContain('checked=""');
    expect(html).toContain('aria-readonly="true"');
    expect(html).toContain('tabindex="-1"');
  });

  it("puts a diff row's full line in its title", () => {
    const html = render({ sessionId: SESSION, turn: { diff: { file: "a.ts", added: 1, removed: 1, lines: ["-  const old = 1;", "+  const next = 2;"] } } });
    expect(html).toContain('title="+  const next = 2;"');
    expect(html).toContain("spexr-agent-diff__row--del");
  });

  it("holds the prompt's full text as its title", () => {
    expect(render({ sessionId: SESSION, turn: { prompt: "do the thing" } })).toContain('class="spexr-agent-prompt" title="do the thing"');
  });

  it("sets backtick spans in the prompt as inline code too, as the demo's prompt does", () => {
    const html = render({ sessionId: SESSION, turn: { prompt: "Make `cache.write` awaited" } });
    expect(html).toMatch(/class="spexr-agent-prompt"[^>]*>Make <code class="sl-code">cache\.write<\/code> awaited</);
    expect(html).toContain('title="Make `cache.write` awaited"');
  });

  it("makes the tool list a keyboard-reachable scroll region", () => {
    expect(render({ sessionId: SESSION, turn: { tools: tools(2) } })).toMatch(/<ol [^>]*tabindex="0"/);
  });

  it("derives its ids from the instance, not a fixed string", () => {
    const html = render({ sessionId: SESSION, turn: { tools: tools(6) }, plan: [{ text: "One", done: false }] }, false);
    expect(html).not.toContain('id="spexr-agent-tools-list"');
    expect(html).not.toContain('id="spexr-agent-plan-title"');
    const listId = /<ol id="([^"]+)"/.exec(html)![1]!;
    expect(html).toContain(`aria-controls="${listId}"`);
    const planId = /class="sl-eyebrow" id="([^"]+)"/.exec(html)![1]!;
    expect(html).toContain(`aria-labelledby="${planId}"`);
    expect(planId).not.toBe(listId);
  });

  it("makes Reveal a plain small kit button, which carries the kit's control edge", () => {
    expect(render({ sessionId: SESSION, needsYou: true })).toMatch(/<button type="button" class="sl-btn sl-btn--sm">Reveal<\/button>/);
  });
});

describe("the widget's show handler", () => {
  it("binds again whenever the pane comes into view, which retries a follow that failed", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("./agent-pane-widget.tsx", import.meta.url)), "utf8");
    expect(src).toMatch(/protected override onAfterShow\(msg: Message\): void \{\s*super\.onAfterShow\(msg\);\s*void this\.controller\.bind\(\);\s*\}/);
  });
});
