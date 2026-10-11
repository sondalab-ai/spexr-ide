/**
 * TC-06 — Edge cases: corrupted context files, shipped spec, empty workspace
 */
import path from "path";
import fs from "fs";
import { test, expect, sel, openSpecView, waitForSpecList } from "../fixtures/app.js";

function seedSpec(
  workspace: string,
  slug: string,
  opts: { status?: string; workflowStep?: string; corruptDrift?: boolean } = {},
): void {
  const specsDir = path.join(workspace, "docs/specs");
  const contextDir = path.join(workspace, `docs/specs/.context/${slug}`);
  fs.mkdirSync(contextDir, { recursive: true });

  const status = opts.status ?? "in-progress";
  const workflowStep = opts.workflowStep ?? "implement";

  fs.writeFileSync(
    path.join(specsDir, `${slug}.md`),
    `---
slug: ${slug}
title: Test Spec
status: ${status}
workflowStep: ${workflowStep}
createdAt: 2026-01-01
---

## Goal

Something concrete.

## Acceptance Criteria

- **AC-1** The system must do X.
`,
    "utf8",
  );

  if (opts.corruptDrift) {
    fs.writeFileSync(path.join(contextDir, "_drift.json"), "not-valid-json{{{", "utf8");
  }
}

test.describe("Workflow edge cases", () => {
  test("empty workspace shows no-specs message", async ({ page }) => {
    await openSpecView(page);
    const empty = page.locator(".spexr-spec-panel__empty");
    await expect(empty).toBeVisible({ timeout: 5_000 });
  });

  test("shipped spec shows Retrospective button instead of Chat", async ({
    page,
    workspace,
  }) => {
    seedSpec(workspace, "0001-shipped-spec", { status: "shipped" });
    await openSpecView(page);
    await waitForSpecList(page);

    const retroBtn = page.locator("button:has-text('Retrospective with agent')");
    await expect(retroBtn).toBeVisible({ timeout: 5_000 });

    const chatBtn = page.locator("button:has-text('Chat with agent')");
    await expect(chatBtn).not.toBeVisible();
  });

  test("corrupted _drift.json does not crash the widget", async ({ page, workspace }) => {
    seedSpec(workspace, "0001-test-spec", {
      status: "implemented",
      workflowStep: "validate",
      corruptDrift: true,
    });

    await openSpecView(page);
    // Should load without throwing — spec item visible, no crash overlay
    await waitForSpecList(page);
    const items = page.locator(sel.specItem);
    await expect(items).toHaveCount(1, { timeout: 5_000 });

    // No Theia error toast about JSON parse. Theia marks an error only on its
    // glyph (.theia-notification-icon.error); the "--error" modifier this
    // looked for does not exist, so the check could never fail. The center
    // keeps a hidden copy of every notification, so only the toasts are read.
    const errNotification = page.locator(
      '.theia-notification-toasts .theia-notification-list-item:has(.theia-notification-icon.error):has-text("JSON")',
    );
    await expect(errNotification).not.toBeVisible({ timeout: 3_000 });
  });

  test("refresh reloads spec list", async ({ page, workspace }) => {
    await openSpecView(page);
    // No specs initially
    await expect(page.locator(sel.specItem)).toHaveCount(0, { timeout: 3_000 });

    // Seed a spec after the panel is open
    seedSpec(workspace, "0001-late-spec");

    await page.click(sel.refreshBtn);
    await waitForSpecList(page);
    await expect(page.locator(sel.specItem)).toHaveCount(1, { timeout: 5_000 });
  });

  test("deleting spec removes it from the list", async ({ page, workspace }) => {
    seedSpec(workspace, "0001-delete-me");
    await openSpecView(page);
    await waitForSpecList(page);

    const deleteBtn = page
      .locator(sel.specItem)
      .first()
      .locator("button[aria-label*='Delete']");
    await deleteBtn.click();

    // deleteSpec shows a ConfirmDialog — click the OK button to confirm.
    const confirmBtn = page.locator('#theia-dialog-shell button:has-text("Delete")');
    await confirmBtn.waitFor({ timeout: 3_000 });
    await confirmBtn.click();

    // Spec file should be gone from disk
    await expect
      .poll(() => fs.existsSync(path.join(workspace, "docs/specs/0001-delete-me.md")), {
        timeout: 5_000,
      })
      .toBe(false);

    // List now empty
    await expect(page.locator(sel.specItem)).toHaveCount(0, { timeout: 5_000 });
  });
});
