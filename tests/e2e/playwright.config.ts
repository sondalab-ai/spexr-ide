import { defineConfig } from "@playwright/test";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "../..");

// The suite launches the spexr Electron app once per test, and a local run
// has opened enough windows to crash a workstation. Refuse at config load
// unless this is a GitHub Actions runner: that covers `pnpm test:e2e`, `npx
// playwright test` from tests/e2e and an IDE that discovers this config. A
// run from another directory, or with `-c`, never loads this file, so the
// `app` fixture in fixtures/app.ts refuses again before it launches anything.
if (process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("tests/e2e launches spexr and runs only on a GitHub Actions runner (.github/workflows/e2e.yml).");
}

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    // Shared across all tests via the ElectronApp fixture.
    // Individual tests receive `app` and `page` from the fixture.
  },
  projects: [
    {
      name: "electron",
      testMatch: "**/*.spec.ts",
    },
  ],
});

export { REPO_ROOT };
