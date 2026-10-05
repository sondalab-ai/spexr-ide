import { defineConfig } from "@playwright/test";

/**
 * The screenshot capture, started only by run.mjs (which refuses to run
 * outside CI). Its own config and file pattern, so tests/e2e never picks it
 * up and this never picks up the e2e specs.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "capture.visual.ts",
  timeout: 30 * 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
});
