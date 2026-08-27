import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { execFile } from "node:child_process";
import { detectInstalledHarnesses } from "./spexr-darkfactory-backend-service.js";
import { claudeHarness } from "../../common/harness/claude-harness.js";
import { opencodeHarness } from "../../common/harness/opencode-harness.js";

const execFileMock = execFile as unknown as ReturnType<typeof vi.fn>;

/** Drive the mocked login-shell `command -v`: found → path on stdout, else err. */
function mockCommandV(found: (bin: string) => boolean): void {
  execFileMock.mockImplementation((...all: unknown[]) => {
    const argv = (all.find((a) => Array.isArray(a)) ?? []) as string[];
    const cb = all.find((a) => typeof a === "function") as
      | ((e: Error | null, out: string) => void)
      | undefined;
    if (!cb) return;
    const bin = (argv[argv.length - 1] ?? "").replace("command -v ", "");
    if (found(bin)) cb(null, `/opt/homebrew/bin/${bin}\n`);
    else cb(new Error("not found"), "");
  });
}

describe("detectInstalledHarnesses", () => {
  beforeEach(() => execFileMock.mockReset());

  it("includes Claude, which answers for itself, without probing", async () => {
    mockCommandV(() => false); // even if every probe fails, Claude stays
    const installed = await detectInstalledHarnesses([claudeHarness, opencodeHarness]);
    expect(installed).toEqual([claudeHarness]);
  });

  it("includes opencode when `command -v opencode` resolves", async () => {
    mockCommandV((bin) => bin === "opencode");
    const installed = await detectInstalledHarnesses([claudeHarness, opencodeHarness]);
    expect(installed).toEqual([claudeHarness, opencodeHarness]);
  });

  it("only shells out for harnesses that do not answer for themselves", async () => {
    const probed: string[] = [];
    mockCommandV((bin) => {
      probed.push(bin);
      return true;
    });
    await detectInstalledHarnesses([claudeHarness, opencodeHarness]);
    expect(probed).toEqual(["opencode"]);
  });

  it("carries no knowledge of any particular harness id", async () => {
    // A harness declaring itself absent must be dropped, and one with no
    // opinion must still be probed — neither outcome depends on its id.
    mockCommandV(() => true);
    const absent = { ...claudeHarness, isInstalled: () => Promise.resolve(false) };
    const probeOnly = { ...opencodeHarness, isInstalled: undefined };
    const installed = await detectInstalledHarnesses([absent, probeOnly]);
    expect(installed).toEqual([probeOnly]);
  });
});
