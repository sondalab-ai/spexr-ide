import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GlyphLaneModel, explicitGlyphMargin, glyphLane, glyphMarginOption, refreshGlyphLanes, type GlyphLaneSources, type InspectedValues, type LaneEditor } from "./spexr-glyph-lane.js";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const read = (path: string): string => readFileSync(path, "utf8");

const sources = (over: { inspect?: InspectedValues; breakpoints?: Record<string, number>; sessions?: number }): GlyphLaneSources => ({
  inspect: () => over.inspect,
  breakpointsIn: (uri) => over.breakpoints?.[uri] ?? 0,
  sessionCount: () => over.sessions ?? 0,
});

describe("the glyph lane", () => {
  it("is off by default: no breakpoints, no session", () => {
    expect(glyphLane({ explicit: undefined, debugActive: false, modelBreakpoints: 0 })).toBe(false);
  });

  it("shows in an editor whose model has breakpoints, and only in that one", () => {
    const s = sources({ breakpoints: { "file:///a.ts": 2 } });
    expect(glyphMarginOption(s, "file:///a.ts")).toEqual({ glyphMargin: true });
    expect(glyphMarginOption(s, "file:///b.ts")).toEqual({ glyphMargin: false });
  });

  it("shows in every editor while a debug session is active, and hides again when it ends", () => {
    expect(glyphMarginOption(sources({ sessions: 1 }), "file:///b.ts")).toEqual({ glyphMargin: true });
    expect(glyphMarginOption(sources({ sessions: 0 }), "file:///b.ts")).toEqual({ glyphMargin: false });
  });

  it("hides again when the last breakpoint is removed", () => {
    const breakpoints = { "file:///a.ts": 1 };
    const s = sources({ breakpoints });
    expect(glyphMarginOption(s, "file:///a.ts")).toEqual({ glyphMargin: true });
    breakpoints["file:///a.ts"] = 0;
    expect(glyphMarginOption(s, "file:///a.ts")).toEqual({ glyphMargin: false });
  });

  it("leaves the editor to the user's own preference, whatever debugging does", () => {
    for (const inspect of [{ globalValue: true }, { globalValue: false }, { workspaceValue: false }, { workspaceFolderValue: true }]) {
      expect(glyphMarginOption(sources({ inspect, sessions: 1, breakpoints: { "file:///a.ts": 3 } }), "file:///a.ts"), JSON.stringify(inspect)).toBeUndefined();
    }
  });

  it("reads the user's value from the user, workspace and folder scopes, never the app's default", () => {
    expect(explicitGlyphMargin(undefined)).toBeUndefined();
    expect(explicitGlyphMargin({})).toBeUndefined();
    expect(explicitGlyphMargin({ globalValue: true })).toBe(true);
    expect(explicitGlyphMargin({ globalValue: true, workspaceFolderValue: false })).toBe(false);
    expect(explicitGlyphMargin({ globalValue: "yes" })).toBeUndefined();
  });
});

describe("what the glyph lane relies on in Theia", () => {
  it("is driven by the breakpoint and session events and reads", () => {
    const breakpoints = read(require.resolve("@theia/debug/lib/browser/breakpoint/breakpoint-manager.js"));
    expect(breakpoints).toMatch(/this\.onDidChangeBreakpoints = this\.onDidChangeBreakpointsEmitter\.event/);
    expect(breakpoints).toMatch(/getBreakpoints\(uri\)/);
    const sessions = read(require.resolve("@theia/debug/lib/browser/debug-session-manager.js"));
    for (const name of ["onDidStartDebugSession", "onDidDestroyDebugSession"]) expect(sessions, name).toMatch(new RegExp(`this\\.${name} = `));
    expect(sessions).toMatch(/get sessions\(\)/);
    expect(read(require.resolve("@theia/core/lib/common/preferences/preference-service.js"))).toMatch(/inspect\(preferenceName/);
  });

  it("is wired: the provider asks for the option, the contribution updates open editors, the default stays off", () => {
    const provider = read(join(here, "spexr-monaco-editor-provider.ts"));
    expect(provider).toMatch(/\.\.\.this\.glyphLane\.optionFor\(model\.uri\)/);
    const contribution = read(join(here, "spexr-glyph-lane-contribution.ts"));
    expect(contribution).toMatch(/refreshGlyphLanes\(open, this\.lane, this\.held\)/);
    expect(contribution).toMatch(/instanceof MonacoEditor/);
    expect(contribution).toMatch(/skips diff editors on purpose/);
    expect(contribution).toMatch(/this\.lane\.onDidChange\(/);
    const module = read(join(here, "../spexr-frontend-module.ts"));
    const service = read(join(here, "spexr-glyph-lane-service.ts"));
    expect(service).toMatch(/@inject\(BreakpointManager\) @optional\(\)/);
    expect(service).toMatch(/@inject\(DebugSessionManager\) @optional\(\)/);
    expect(service).toMatch(/inspect<boolean>\("editor\.glyphMargin", uri\)/);
    expect(module).toMatch(/bind\(FrontendApplicationContribution\)\.toService\(SpexrGlyphLaneContribution\)/);
    expect(module).toMatch(/bind\(SpexrGlyphLane\)\.toSelf\(\)\.inSingletonScope\(\)/);
    const pkg = JSON.parse(read(join(here, "../../../../../apps/desktop/package.json"))) as { theia: { frontend: { config: { preferences: Record<string, unknown> } } } };
    expect(pkg.theia.frontend.config.preferences["editor.glyphMargin"]).toBe(false);
  });
});

type Listener = () => void;
class Event {
  private readonly listeners: Listener[] = [];
  readonly subscribe = (l: Listener): void => void this.listeners.push(l);
  fire(): void {
    this.listeners.forEach((l) => l());
  }
}

describe("GlyphLaneModel and refreshGlyphLanes, with stub managers and editors", () => {
  const setup = (over: { user?: InspectedValues; debug?: boolean } = {}) => {
    const breakpoints: Record<string, number> = {};
    const state = { sessions: 0 };
    const bp = new Event();
    const session = new Event();
    const inspected: Array<string | undefined> = [];
    const model = new GlyphLaneModel({
      inspect: () => undefined,
      inspectFor: (uri) => (inspected.push(uri), over.user),
      breakpointsIn: (uri) => breakpoints[uri] ?? 0,
      sessionCount: () => state.sessions,
      subscriptions: over.debug === false ? [] : [bp.subscribe, session.subscribe],
    });
    const calls: Array<[string, { glyphMargin: boolean }]> = [];
    const editor = (uri: string): LaneEditor => ({ uri: { toString: () => uri }, getControl: () => ({ updateOptions: (o) => void calls.push([uri, o]) }) });
    return { model, breakpoints, state, bp, session, inspected, calls, editor };
  };

  it("passes the editor's resource to the preference inspection, so a folder value of a multi-root workspace counts", () => {
    const t = setup();
    t.model.optionFor("file:///root-b/a.ts");
    expect(t.inspected).toEqual(["file:///root-b/a.ts"]);
  });

  it("calls updateOptions only on an editor whose lane decision changed", () => {
    const t = setup();
    const [a, b] = [t.editor("file:///a.ts"), t.editor("file:///b.ts")];
    const held = new WeakMap<object, boolean>();
    t.model.onDidChange(() => refreshGlyphLanes([a, b], t.model, held));
    t.breakpoints["file:///a.ts"] = 1;
    t.bp.fire();
    expect(t.calls).toEqual([["file:///a.ts", { glyphMargin: true }]]);
    t.bp.fire();
    expect(t.calls).toHaveLength(1);
    t.state.sessions = 1;
    t.session.fire();
    expect(t.calls).toEqual([["file:///a.ts", { glyphMargin: true }], ["file:///b.ts", { glyphMargin: true }]]);
    t.state.sessions = 0;
    t.breakpoints["file:///a.ts"] = 0;
    t.session.fire();
    expect(t.calls).toHaveLength(4);
    expect(t.calls.slice(2).map(([, o]) => o.glyphMargin)).toEqual([false, false]);
  });

  it("leaves an editor alone when the user set the preference", () => {
    const t = setup({ user: { globalValue: false } });
    const a = t.editor("file:///a.ts");
    const held = new WeakMap<object, boolean>();
    t.model.onDidChange(() => refreshGlyphLanes([a], t.model, held));
    t.state.sessions = 1;
    t.session.fire();
    t.breakpoints["file:///a.ts"] = 2;
    t.bp.fire();
    expect(t.calls).toEqual([]);
  });

  it("does not throw, and keeps the lane off, without the debug managers", () => {
    const t = setup({ debug: false });
    expect(t.model.optionFor("file:///a.ts")).toEqual({ glyphMargin: false });
    const held = new WeakMap<object, boolean>();
    refreshGlyphLanes([t.editor("file:///a.ts")], t.model, held);
    expect(t.calls).toEqual([]);
  });
});
