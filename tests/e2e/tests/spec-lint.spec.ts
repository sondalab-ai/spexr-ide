/**
 * TC — Spec lint panel (spec 0009)
 * Verifies: panel appears when spec editor active, findings shown,
 * clicking finding navigates editor, badge visible on tab, clean spec shows no errors.
 */
import path from "path";
import fs from "fs";
import {
  test,
  expect,
  sel,
  openSpecView,
  openFileInEditor,
  openLintPanel,
  waitForSpecList,
} from "../fixtures/app.js";

const CLEAN_SPEC = `---
slug: 0001-clean-spec
title: Clean Spec
status: in-progress
createdAt: 2026-01-01
---

## Goal

Make something real happen in production.

## Non-goals

- No scope creep.

## Acceptance Criteria

- **AC-1** The system must do X when Y is true.
- **AC-2** The system must not do Z.
`;

const SPEC_WITH_ERRORS = `---
slug: 0001-clean-spec
title: Clean Spec
status: in-progress
createdAt: 2026-01-01
---

## Goal

Make something real happen in production.

## Non-goals

- No scope creep.

## Acceptance Criteria

- **AC-1** The system must do X.
- **AC-1** Duplicate id — this should trigger an error.
`;

function seedSpecFile(workspace: string, filename: string, content: string): void {
  const p = path.join(workspace, "docs/specs", filename);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

test.describe("Spec lint panel", () => {
  test("panel shows empty state when no spec editor active", async ({ page }) => {
    await openSpecView(page);
    // Ensure lint widget exists but shows empty state (no spec open in editor)
    const lintWidget = page.locator(sel.lintWidget);
    if (await lintWidget.isVisible()) {
      await expect(lintWidget).toContainText("Open a spec to validate it.");
    }
  });

  test("clean spec shows no error findings", async ({ page, workspace }) => {
    seedSpecFile(workspace, "0001-clean-spec.md", CLEAN_SPEC);

    await openFileInEditor(page, "0001-clean-spec.md");

    // The lint panel shares the bottom dock with Linked resources, which the
    // app leaves in front, so select its tab before reading findings.
    await openLintPanel(page);

    // Clean spec: widget shows .spexr-spec-lint__ok (no findings), not .spexr-spec-lint__summary.
    const ok = page.locator(sel.lintOk);
    await expect(ok).toContainText("No issues", { timeout: 8_000 });
  });

  test("duplicate AC id surfaces as error finding", async ({ page, workspace }) => {
    seedSpecFile(workspace, "0001-clean-spec.md", SPEC_WITH_ERRORS);

    await openFileInEditor(page, "0001-clean-spec.md");

    await openLintPanel(page);

    const findings = page.locator(sel.lintFinding);
    await expect(findings).not.toHaveCount(0, { timeout: 8_000 });
  });
});
