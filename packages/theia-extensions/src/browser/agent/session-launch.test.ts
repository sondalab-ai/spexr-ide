import { describe, expect, it } from "vitest";
import type { LaunchPlan } from "../../common/claude-launch-profiles.js";
import { agentSessionKey, launchLine, shellQuote, withSessionId } from "./session-launch.js";

const ID = "8f2a4c1e-3b7d-4e52-9a61-0c5d2e8b7f13";

describe("withSessionId", () => {
  it("appends --session-id to a bare launch, and says it did", () => {
    expect(withSessionId([], ID)).toEqual({ args: ["--session-id", ID], applied: true });
  });

  it("appends it after the other arguments", () => {
    expect(withSessionId(["--append-system-prompt-file", "/p/x.md"], ID).args).toEqual(["--append-system-prompt-file", "/p/x.md", "--session-id", ID]);
  });

  it.each([["--session-id"], ["--resume"], ["-r"], ["--continue"], ["-c"], ["--session-id=abc"]])("leaves args that already choose the session (%s) and says it did not apply", (flag) => {
    expect(withSessionId([flag, "x"], ID)).toEqual({ args: [flag, "x"], applied: false });
  });

  it("does not mutate its input", () => {
    const args = ["a"];
    withSessionId(args, ID);
    expect(args).toEqual(["a"]);
  });
});

describe("launchLine", () => {
  const args = withSessionId(["--append-system-prompt-file", "/p/x y.md"], ID).args;

  it("puts --session-id <uuid> after a wrapper command, which stays unquoted so an alias expands", () => {
    const plan: LaunchPlan = { command: "cld-perso", exportConfigDir: "", unquoted: true };
    const line = launchLine(plan, args);
    expect(line).toBe(`unset CLAUDE_CONFIG_DIR; cld-perso '--append-system-prompt-file' '/p/x y.md' '--session-id' '${ID}'`);
    expect(line.indexOf("cld-perso")).toBeLessThan(line.indexOf("--session-id"));
  });

  it("quotes an executable path and exports the account the plan names", () => {
    const plan: LaunchPlan = { command: "/opt/my claude/bin/claude", exportConfigDir: "/home/u/.claude-work", unquoted: false };
    const line = launchLine(plan, ["--session-id", ID]);
    expect(line).toMatch(/^export CLAUDE_CONFIG_DIR=.*\.claude-work.*; '\/opt\/my claude\/bin\/claude' '--session-id' '/);
    expect(line.endsWith(`'${ID}'`)).toBe(true);
  });

  it("quotes a single quote in an argument", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe("agentSessionKey", () => {
  it("is per workspace", () => {
    expect(agentSessionKey("file:///a")).not.toBe(agentSessionKey("file:///b"));
    expect(agentSessionKey("file:///a")).toBe("spexr.agent.session:file:///a");
  });
});
