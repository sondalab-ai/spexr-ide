import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HIDDEN_STATUS_IDS, LANGUAGE_MODE_ID, LANGUAGE_STATUS_ID, PANEL_TOGGLE_ID, RESOURCES_ID, RIGHT_ORDER, TABBING_ID, shapeStatusEntry } from "./status-items.js";
import { pollAction } from "../resources/resource-poll-gate.js";

const resolve = createRequire(import.meta.url).resolve;
const theia = (file: string): string => readFileSync(resolve(file), "utf8");
const own = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

const off = { resources: false };
const on = { resources: true };

describe("the ids are the ones Theia gives its entries", () => {
  it("names the entries it hides and orders", () => {
    expect(theia("@theia/monaco/src/browser/monaco-status-bar-contribution.ts")).toContain(`EDITOR_STATUS_TABBING_CONFIG = '${TABBING_ID}'`);
    const language = theia("@theia/editor/src/browser/language-status/editor-language-status-service.ts");
    expect(language).toContain(`LANGUAGE_STATUS_ID = '${LANGUAGE_STATUS_ID}'`);
    expect(language).toContain(`LANGUAGE_MODE_ID = '${LANGUAGE_MODE_ID}'`);
    expect(theia("@theia/core/src/browser/shell/application-shell.ts")).toContain(`BOTTOM_PANEL_TOGGLE_ID = '${PANEL_TOGGLE_ID}'`);
    const editor = theia("@theia/editor/src/browser/editor-contribution.ts");
    expect(editor).toContain("'editor-status-cursor-position'");
    expect(editor).toContain("'editor-status-encoding'");
    expect(theia("@theia/monaco/src/browser/monaco-status-bar-contribution.ts")).toContain("EDITOR_STATUS_EOL = 'editor-status-eol'");
    expect(own("../resources/resource-status-bar-contribution.ts")).toContain(`ENTRY_ID = "${RESOURCES_ID}"`);
  });
});

describe("the status bar's entries (S6d, S1/S2)", () => {
  const entry = { text: "x", alignment: 1, priority: 1 };

  it("hides indentation, the language status and the panel toggle", () => {
    expect(HIDDEN_STATUS_IDS).toEqual([TABBING_ID, LANGUAGE_STATUS_ID, PANEL_TOGGLE_ID]);
    for (const id of HIDDEN_STATUS_IDS) expect(shapeStatusEntry(id, entry, on)).toBeUndefined();
  });

  it("hides the language's pinned items, which hang on its entry", () => {
    expect(shapeStatusEntry("some-formatter", { ...entry, affinity: { id: LANGUAGE_MODE_ID } }, on)).toBeUndefined();
    expect(shapeStatusEntry("other", { ...entry, affinity: { id: "elsewhere" } }, on)).toBeDefined();
  });

  it("orders the right side Ln/Col, UTF-8, LF, language, whatever priorities Theia gave", () => {
    const theiaPriority: Record<string, number> = { "editor-status-cursor-position": 100, "editor-status-encoding": 10, "editor-status-eol": 11, [LANGUAGE_MODE_ID]: 1 };
    const shaped = Object.entries(theiaPriority).map(([id, priority]) => ({ id, priority: shapeStatusEntry(id, { ...entry, priority }, off)!.priority! }));
    // The bar puts the higher priority further left.
    const leftToRight = [...shaped].sort((a, b) => b.priority - a.priority).map((e) => e.id);
    expect(leftToRight).toEqual(["editor-status-cursor-position", "editor-status-encoding", "editor-status-eol", LANGUAGE_MODE_ID]);
    expect(RIGHT_ORDER.slice(0, 4)).toEqual(leftToRight);
  });

  it("puts the resource meter after the language when it is on, and drops it when it is off", () => {
    expect(shapeStatusEntry(RESOURCES_ID, entry, off)).toBeUndefined();
    const meter = shapeStatusEntry(RESOURCES_ID, entry, on)!.priority!;
    expect(meter).toBeLessThan(shapeStatusEntry(LANGUAGE_MODE_ID, entry, on)!.priority!);
    expect(meter).toBeGreaterThan(1000);
  });

  it("leaves every other entry as it is", () => {
    expect(shapeStatusEntry("spexr-git-branch", entry, off)).toBe(entry);
    expect(shapeStatusEntry("problem-marker-status", entry, off)).toBe(entry);
  });

  it("goes through every entry set, in the model the bar and the service share", () => {
    const model = own("./status-bar-view-model.ts");
    expect(model).toContain("extends StatusBarViewModel");
    expect(model).toMatch(/shapeStatusEntry\(id, entry, \{ resources: this\.preferences\.get<boolean>\(SPEXR_STATUS_RESOURCES_PREFERENCE, false\) \}\)/);
    expect(own("../spexr-frontend-module.ts")).toContain("rebind(StatusBarViewModel).to(SpexrStatusBarViewModel)");
    expect(theia("@theia/core/src/browser/status-bar/index.ts")).toContain("bind(StatusBarViewModel).toSelf().inSingletonScope()");
  });
});

describe("the resource meter's preference (D14)", () => {
  it("is off by default", () => {
    const schema = own("../preferences/spexr-preferences.ts");
    const at = schema.indexOf("[SPEXR_STATUS_RESOURCES_PREFERENCE]: {");
    expect(at).toBeGreaterThan(0);
    expect(schema.slice(at, schema.indexOf("},", at))).toMatch(/type: "boolean",\s*default: false,/);
    expect(schema).toContain('SPEXR_STATUS_RESOURCES_PREFERENCE = "spexr.statusBar.resources"');
  });

  it("starts the poller when turned on while idle, stops it when turned off while running, else does nothing", () => {
    expect(pollAction(true, false)).toBe("start");
    expect(pollAction(false, true)).toBe("stop");
    expect(pollAction(true, true)).toBe("none");
    expect(pollAction(false, false)).toBe("none");
  });

  it("is read by the contribution: no sample is asked for until the preference is on", () => {
    const source = own("../resources/resource-status-bar-contribution.ts");
    expect(source).toContain("pollAction(this.preferences.get<boolean>(SPEXR_STATUS_RESOURCES_PREFERENCE, false), this.running)");
    expect(source).toMatch(/private async poll\(\): Promise<void> \{\s*if \(!this\.running\) return;/);
  });
});
