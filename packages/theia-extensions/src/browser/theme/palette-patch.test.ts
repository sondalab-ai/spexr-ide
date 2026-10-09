import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PALETTE } from "../shell/workbench-geometry.js";

const resolve = createRequire(import.meta.url).resolve;
const repo = (file: string): string => readFileSync(fileURLToPath(new URL(`../../../../../${file}`, import.meta.url)), "utf8");
const LIST = "@theia/monaco-editor-core/esm/vs/platform/quickinput/browser/quickInputList.js";

/** Monaco's item delegate: the heights the quick input's list lays its rows out at. */
function delegate(source: string): string {
  const start = source.indexOf("class QuickInputItemDelegate {");
  expect(start, "QuickInputItemDelegate").toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("getTemplateId", start));
}

// The palette's rows are laid out by Monaco's list from the delegate's
// getHeight, which CSS cannot change: pnpm applies spexr's patch to
// @theia/monaco-editor-core (the installed file is the patched one).
describe("the patch to Monaco's quick input list", () => {
  it("is registered for the version Theia uses, in package.json and the lockfile", () => {
    const pkg = JSON.parse(repo("package.json")) as { pnpm: { patchedDependencies: Record<string, string> } };
    const version = (JSON.parse(readFileSync(resolve("@theia/monaco-editor-core/package.json"), "utf8")) as { version: string }).version;
    expect(pkg.pnpm.patchedDependencies[`@theia/monaco-editor-core@${version}`]).toBe(`patches/@theia__monaco-editor-core@${version}.patch`);
    expect(repo("pnpm-lock.yaml")).toMatch(new RegExp(`'@theia/monaco-editor-core@${version.replace(/\./g, "\\.")}':\\s+hash: \\w+\\s+path: patches/@theia__monaco-editor-core@${version.replace(/\./g, "\\.")}\\.patch`));
  });

  it("gives a row, a row with a detail line and a group heading the table's heights", () => {
    const heights = delegate(readFileSync(resolve(LIST), "utf8"));
    expect(heights).toMatch(new RegExp(`QuickPickSeparatorElement\\) \\{\\s*return ${PALETTE.group};`));
    expect(heights).toMatch(new RegExp(`element\\.saneDetail \\? ${PALETTE.detailRow} : ${PALETTE.row};`));
  });

  it("aligns the list's height to the row, not to Monaco's 44px pair of rows", () => {
    expect(readFileSync(resolve(LIST), "utf8")).toContain(`Math.floor(maxHeight / ${PALETTE.row}) * ${PALETTE.row}`);
  });
});
