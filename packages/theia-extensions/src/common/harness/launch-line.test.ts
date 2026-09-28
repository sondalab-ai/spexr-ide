import { describe, expect, it } from "vitest";
import { buildLaunchLine, shellQuote } from "./launch-line.js";

const claudePlan = { command: "claude", exportConfigDir: "", unquoted: true };

describe("buildLaunchLine", () => {
  it("unsets the account, cds, runs the harness and keeps a shell for the wall", () => {
    expect(
      buildLaunchLine({ plan: claudePlan, args: ["--resume", "abc"], cwd: "/repo", ownsAccount: true, keepShell: true }),
    ).toBe(`unset CLAUDE_CONFIG_DIR; cd '/repo'; claude '--resume' 'abc'; exec "$SHELL" -i`);
  });
  it("exports a home-relative account through $HOME and quotes a path command", () => {
    const plan = { command: "/opt/bin/claude", exportConfigDir: "~/.claude-perso", unquoted: false };
    expect(buildLaunchLine({ plan, args: [], cwd: "/r", ownsAccount: true, keepShell: true })).toBe(
      `export CLAUDE_CONFIG_DIR="$HOME"'/.claude-perso'; cd '/r'; '/opt/bin/claude'; exec "$SHELL" -i`,
    );
  });
  it("leaves the account alone for opencode", () => {
    const plan = { command: "opencode", exportConfigDir: "", unquoted: true };
    expect(buildLaunchLine({ plan, args: [], cwd: "/r", ownsAccount: false, keepShell: true })).toBe(
      `cd '/r'; opencode; exec "$SHELL" -i`,
    );
  });
  it("ends with the harness for a scheduled task, so its exit ends the pty", () => {
    expect(buildLaunchLine({ plan: claudePlan, args: ["hi"], cwd: "/r", ownsAccount: true, keepShell: false })).toBe(
      `unset CLAUDE_CONFIG_DIR; cd '/r'; claude 'hi'`,
    );
  });
  it("quotes a prompt carrying quotes and shell syntax", () => {
    const line = buildLaunchLine({ plan: claudePlan, args: [`it's $(rm -rf ~)`], cwd: "/r", ownsAccount: true, keepShell: false });
    expect(line.endsWith(`claude 'it'\\''s $(rm -rf ~)'`)).toBe(true);
  });
});

describe("shellQuote", () => {
  it("wraps in single quotes and escapes embedded ones", () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });
});
