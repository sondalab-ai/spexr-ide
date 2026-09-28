import { describe, expect, it } from "vitest";
import type { Schedule, ScheduleTask } from "../../../common/schedule/schedule-types.js";
import {
  accountOptions,
  handOffRange,
  insertAt,
  needChoices,
  placeholderChoices,
  staleWorkspaceOption,
  withAccount,
  withNeed,
  withWorkspace,
  workspaceOptions,
  workspaceValue,
} from "./task-edit.js";

const t = (id: string, needs: string[] = []): ScheduleTask => ({
  id, name: id.toUpperCase(), needs, project: "/r", workspace: { kind: "folder" }, harness: "claude", prompt: "p",
});
const s: Schedule = { id: "s", name: "S", tasks: [t("a"), t("b", ["a"]), t("c", ["b"]), t("d")] };

describe("waits for", () => {
  it("offers every other task, blocking the ones that already wait for this one (R23)", () => {
    expect(needChoices(s, "a")).toEqual([
      { id: "b", name: "B", checked: false, blockedBy: "B already waits for this task." },
      { id: "c", name: "C", checked: false, blockedBy: "C already waits for this task." },
      { id: "d", name: "D", checked: false },
    ]);
    expect(needChoices(s, "c").map((n) => [n.id, n.checked, n.blockedBy])).toEqual([
      ["a", false, undefined],
      ["b", true, undefined],
      ["d", false, undefined],
    ]);
  });
  it("adds and removes a link without duplicates", () => {
    expect(withNeed(t("c", ["b"]), "a", true).needs).toEqual(["b", "a"]);
    expect(withNeed(t("c", ["b"]), "b", true).needs).toEqual(["b"]);
    expect(withNeed(t("c", ["b", "a"]), "b", false).needs).toEqual(["a"]);
  });
});

describe("workspace", () => {
  it("offers the folder, a worktree, and only the tasks upstream of this one", () => {
    expect(workspaceOptions(s, "c").map((o) => o.value)).toEqual(["folder", "worktree", "sameAs:a", "sameAs:b"]);
    expect(workspaceOptions(s, "c")[2]!.label).toBe("Same as A");
    expect(workspaceOptions(s, "d").map((o) => o.value)).toEqual(["folder", "worktree"]);
  });
  it("round-trips the choice", () => {
    for (const v of ["folder", "worktree", "sameAs:a"]) expect(workspaceValue(withWorkspace(t("c"), v).workspace)).toBe(v);
    expect(withWorkspace(t("c"), "sameAs:a").workspace).toEqual({ kind: "sameAs", task: "a" });
  });
  it("names a stale sameAs that still exists, and flags one that does not", () => {
    expect(staleWorkspaceOption(s, "sameAs:d")).toEqual({ value: "sameAs:d", label: "Same as D (not waited for)" });
    expect(staleWorkspaceOption(s, "sameAs:zz")).toEqual({ value: "sameAs:zz", label: "Unknown task: zz" });
    expect(staleWorkspaceOption(s, "folder")).toBeUndefined();
  });
});

describe("hand-offs", () => {
  it("lists each upstream task's reply and folder, in schedule order, and nothing without upstream", () => {
    expect(placeholderChoices(s, "c").map((h) => h.token)).toEqual(["{{a.reply}}", "{{a.workspace}}", "{{b.reply}}", "{{b.workspace}}"]);
    expect(placeholderChoices(s, "c")[0]!.label).toBe("A: final reply");
    expect(placeholderChoices(s, "a")).toEqual([]);
  });
  it("inserts at the caret, replacing a selection, and clamps out-of-range positions", () => {
    expect(insertAt("see  now", 4, 4, "{{a.reply}}")).toEqual({ text: "see {{a.reply}} now", caret: 15 });
    expect(insertAt("see XX now", 4, 6, "T")).toEqual({ text: "see T now", caret: 5 });
    expect(insertAt("ab", 9, 12, "T")).toEqual({ text: "abT", caret: 3 });
  });
  it("targets the end of an untouched field, and the real caret once it has been focused", () => {
    expect(handOffRange(10, false, 0, 0)).toEqual({ start: 10, end: 10 });
    expect(handOffRange(10, true, 0, 0)).toEqual({ start: 0, end: 0 });
    expect(handOffRange(10, true, 3, 7)).toEqual({ start: 3, end: 7 });
    expect(handOffRange(10, false, 3, 7)).toEqual({ start: 10, end: 10 });
  });
});

describe("account", () => {
  const configs = [
    { path: "/u/.claude", label: ".claude", isDefault: true },
    { path: "/u/.claude-work", label: ".claude-work", isDefault: false },
  ];
  it("offers the default account and every known one, keeping an unknown current choice visible", () => {
    expect(accountOptions(configs, undefined)).toEqual([
      { value: "", label: "Default account" },
      { value: "/u/.claude", label: ".claude (default)" },
      { value: "/u/.claude-work", label: ".claude-work" },
    ]);
    expect(accountOptions(configs, "/gone")[3]).toEqual({ value: "/gone", label: "/gone (not found)" });
  });
  it("the default account drops the setting instead of storing an empty path", () => {
    expect(withAccount(t("a"), "/u/.claude-work").configDir).toBe("/u/.claude-work");
    expect("configDir" in withAccount({ ...t("a"), configDir: "/x" }, "")).toBe(false);
  });
});
