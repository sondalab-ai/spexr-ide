import { defineConfig } from "@playwright/test";

// This capture launches the spexr Electron app, and launching it on a
// workstation has opened enough windows to crash one. Refuse at config load
// unless this is a GitHub Actions runner, as playwright.config.ts does; a run
// with another config never loads this file, so launch() in app.ts refuses
// again before it starts anything.
if (process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("tests/visual launches spexr and runs only on a GitHub Actions runner (.github/workflows/marketing-shots.yml).");
}

/**
 * The marketing capture, started by run.mjs with VISUAL_SET=marketing in
 * marketing-shots.yml. Its own file pattern, so the parity capture never
 * picks it up. No step summary: meta.json in the artifact says what each
 * scene waited for.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "marketing.visual.ts",
  timeout: 60 * 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
});
