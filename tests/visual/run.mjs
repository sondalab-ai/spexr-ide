#!/usr/bin/env node

/**
 * Entry point of the screenshot capture: `pnpm --filter @spexr/visual capture`.
 *
 * Refuses to run off a GitHub Actions runner (`GITHUB_ACTIONS=true`). The
 * capture launches the spexr Electron app, and launching it on a workstation
 * has opened enough windows to crash one. This is the friendly message;
 * playwright.config.ts and app.ts refuse too, for every other way in.
 *
 * Runs the Playwright capture (capture.visual.ts), whose global teardown
 * (summary.ts) writes the step summary, and exits with its status. Nothing
 * here compares images or gates anything: the screenshots are for looking at.
 *
 * Env: VISUAL_THEMES (default "dark,light"), VISUAL_OUT (default ./out),
 * VISUAL_HEAD_SHA and VISUAL_REF (the PR head, set by the workflow).
 */

import { spawnSync } from "child_process";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

if (process.env.GITHUB_ACTIONS !== "true") {
  console.error(
    "tests/visual: refusing to run off a GitHub Actions runner. The capture launches the spexr app;\n" +
      "run it through .github/workflows/screenshots.yml (label a PR `screenshots`, or dispatch the workflow).",
  );
  process.exit(1);
}

const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const result = spawnSync(process.execPath, [cli, "test", "--config", path.join(HERE, "playwright.config.ts")], {
  cwd: HERE,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
