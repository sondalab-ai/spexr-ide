import { describe, expect, it } from "vitest";
import { parseSpec } from "./parser.js";

const BASE = `---
slug: 0010-sample
title: Sample spec
status: draft
---

## Goal

Body.
`;

describe("parseSpec frontmatter.forcedSteps", () => {
  it("is undefined when absent", () => {
    const spec = parseSpec(BASE, "/tmp/0010-sample.md");
    expect(spec.frontmatter.forcedSteps).toBeUndefined();
  });

  it("parses a valid forcedSteps array", () => {
    const raw = BASE.replace("status: draft", "status: draft\nforcedSteps: [specify, context]");
    const spec = parseSpec(raw, "/tmp/0010-sample.md");
    expect(spec.frontmatter.forcedSteps).toEqual(["specify", "context"]);
  });

  it("drops unknown step names", () => {
    const raw = BASE.replace("status: draft", "status: draft\nforcedSteps: [specify, bogus]");
    const spec = parseSpec(raw, "/tmp/0010-sample.md");
    expect(spec.frontmatter.forcedSteps).toEqual(["specify"]);
  });
});
