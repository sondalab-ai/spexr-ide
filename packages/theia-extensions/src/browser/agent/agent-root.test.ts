import { describe, expect, it } from "vitest";
import { chooseAgentRoot, rememberedRoot } from "./agent-root.js";

const A = "file:///w/api";
const B = "file:///w/web";
const C = "file:///w/docs";

describe("chooseAgentRoot", () => {
  it("has nothing to offer without a workspace folder", () => {
    expect(chooseAgentRoot({ roots: [] })).toEqual({ kind: "none" });
  });

  it("never asks in a single-folder workspace", () => {
    expect(chooseAgentRoot({ roots: [A] })).toEqual({ kind: "root", root: A });
  });

  it("uses the folder the caller already knows, such as a spec's", () => {
    expect(chooseAgentRoot({ roots: [A, B], known: B })).toEqual({ kind: "root", root: B });
  });

  it("ignores a known folder that is no longer in the workspace", () => {
    expect(chooseAgentRoot({ roots: [A, B], known: C })).toEqual({ kind: "ask", candidates: [A, B] });
  });

  it("asks between several folders, pre-selecting the one being edited", () => {
    expect(chooseAgentRoot({ roots: [A, B, C], hint: B })).toEqual({
      kind: "ask",
      candidates: [A, B, C],
      preselect: B,
    });
  });

  it("only offers the folders the expert is installed in", () => {
    expect(chooseAgentRoot({ roots: [A, B, C], among: [A, C], hint: B })).toEqual({
      kind: "ask",
      candidates: [A, C],
    });
  });

  it("does not ask when the expert is installed in one folder only", () => {
    expect(chooseAgentRoot({ roots: [A, B], among: [B] })).toEqual({ kind: "root", root: B });
  });

  it("falls back to every folder when the expert is installed nowhere", () => {
    expect(chooseAgentRoot({ roots: [A, B], among: [] })).toEqual({ kind: "ask", candidates: [A, B] });
  });
});

describe("rememberedRoot", () => {
  it("keeps the folder the agent last ran in", () => {
    expect(rememberedRoot([A, B], B)).toBe(B);
  });

  it("falls back to the first folder when nothing is remembered", () => {
    expect(rememberedRoot([A, B], undefined)).toBe(A);
  });

  it("falls back to the first folder when the remembered one was removed", () => {
    expect(rememberedRoot([A, B], C)).toBe(A);
  });

  it("is undefined without a workspace folder", () => {
    expect(rememberedRoot([], A)).toBeUndefined();
  });
});
