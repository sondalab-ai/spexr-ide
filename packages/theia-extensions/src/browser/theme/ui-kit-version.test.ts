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
  // 0.15.2 fades the live light to zero at its canvas edge; 0.15.1 ended it on
  // a hard rectangle 6px outside a working card.
  it("is at least 0.15.2", () => {
    const [major, minor, patch] = installedKitVersion().split(".").map(Number) as [number, number, number];
    expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(15_002);
  });
});
