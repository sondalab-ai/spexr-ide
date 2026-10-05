import { defineConfig } from "@playwright/test";

// This suite launches the spexr Electron app, and launching it on a
// workstation has opened enough windows to crash one. Refuse at config load,
// which every entry point passes through (run.mjs, `npx playwright test`, an
// IDE's test discovery), unless this is a GitHub Actions runner: CI=true is
// set by too many local tools to be a safe signal.
if (process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("tests/visual launches spexr and runs only on a GitHub Actions runner (.github/workflows/screenshots.yml).");
}

/**
 * The screenshot capture, started by run.mjs in screenshots.yml. Its own
 * config and file pattern, so tests/e2e never picks it up and this never
 * picks up the e2e specs. summary.ts writes the step summary afterwards,
 * whether the capture passed or not.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "capture.visual.ts",
  globalTeardown: "./summary.ts",
  timeout: 30 * 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
});
