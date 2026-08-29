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

const WITH_CRITERIA = `---
slug: 0010-sample
title: Sample spec
status: draft
---

## Acceptance Criteria

- **AC-1 Findings panel.** The panel renders findings grouped by severity:
  - errors first, then warnings.
- **AC-2** The panel reveals the line of a finding when clicked.
`;

describe("parseSpec acceptanceCriteria", () => {
  it("reads the id out of the `**AC-1 Title.**` form and keeps the title", () => {
    const spec = parseSpec(WITH_CRITERIA, "/tmp/0010-sample.md");
    expect(spec.acceptanceCriteria).toEqual([
      {
        id: "AC-1",
        text: "Findings panel. The panel renders findings grouped by severity:",
      },
      { id: "AC-2", text: "The panel reveals the line of a finding when clicked." },
    ]);
  });
});
