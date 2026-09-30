import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The installed @sondalab/ui-kit version; its package.json is not exported, so find it beside a file that is. */
function installedKitVersion(): string {
  const effects = createRequire(import.meta.url).resolve("@sondalab/ui-kit/effects.js");
  return JSON.parse(readFileSync(join(dirname(effects), "package.json"), "utf8")).version;
}

describe("@sondalab/ui-kit", () => {
  // 0.25.0 gives every control its press (a small squash, sprung back) and
  // makes the glass panes press the same way. 0.24.0 carries accent text in
  // --slc-accent-text (capped darker on light),
  // which spexr's accent-coloured labels read. 0.23 shipped the list,
  // disclosure and resizer, and 0.22 the segmented aria-pressed paint.
  it("is at least 0.25.0", () => {
    const [major, minor, patch] = installedKitVersion().split(".").map(Number) as [number, number, number];
    expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(25_000);
  });
});
