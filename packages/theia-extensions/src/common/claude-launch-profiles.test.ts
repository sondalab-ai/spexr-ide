import { describe, expect, it } from "vitest";
import {
  isValidLaunchCommand,
  launchOptionLabel,
  loginShellArgs,
  mergeLaunchProfiles,
  parseLaunchProfiles,
  profileForConfigDir,
  resolveAgentLaunch,
  resolveLaunchPlan,
  sameConfigDir,
  type ClaudeLaunchProfile,
} from "./claude-launch-profiles.js";

const PERSO: ClaudeLaunchProfile = {
  label: "Perso",
  command: "cld-perso",
  configDir: "~/.claude-perso",
  ownsConfigDir: true,
};

describe("isValidLaunchCommand", () => {
  it.each(["claude", "cld", "cld-perso", "/usr/local/bin/claude", "claude_2.0", "./cld"])(
    "accepts %s",
    (command) => {
      expect(isValidLaunchCommand(command)).toBe(true);
    },
  );

  it.each([
    "cld --resume",
    "cld; rm -rf /",
    "cld && echo",
    "$(whoami)",
    "`id`",
    "cld|tee",
    "cld\nrm",
    "",
    "cl d",
  ])("rejects %j", (command) => {
    expect(isValidLaunchCommand(command)).toBe(false);
  });
});

describe("sameConfigDir", () => {
  it("matches identical paths", () => {
    expect(sameConfigDir("/Users/x/.claude", "/Users/x/.claude")).toBe(true);
  });

  it("matches a tilde reference against the absolute path it names", () => {
    expect(sameConfigDir("~/.claude-perso", "/Users/x/.claude-perso")).toBe(true);
    expect(sameConfigDir("/Users/x/.claude-perso", "~/.claude-perso")).toBe(true);
  });

  it("ignores a trailing slash and surrounding blanks", () => {
    expect(sameConfigDir(" ~/.claude-perso/ ", "/Users/x/.claude-perso")).toBe(true);
  });

  it("does not match a different directory with the same prefix", () => {
    expect(sameConfigDir("~/.claude", "/Users/x/.claude-perso")).toBe(false);
  });

  it("does not match a suffix that is not a path segment", () => {
    expect(sameConfigDir("~/.claude", "/Users/x/work.claude")).toBe(false);
  });

  it("treats an empty reference as no match", () => {
    expect(sameConfigDir("", "/Users/x/.claude")).toBe(false);
  });
});

describe("parseLaunchProfiles", () => {
  it("reads a well-formed entry", () => {
    expect(
      parseLaunchProfiles([
        { label: "Perso", command: "cld-perso", configDir: "~/.claude-perso", ownsConfigDir: true },
      ]),
    ).toEqual([PERSO]);
  });

  it("falls back to the command as label", () => {
    expect(parseLaunchProfiles([{ command: "cld", configDir: "~/.claude" }])[0]).toMatchObject({
      label: "cld",
      ownsConfigDir: false,
    });
  });

  it("drops entries whose command could carry shell syntax", () => {
    expect(parseLaunchProfiles([{ command: "cld; rm -rf /", configDir: "~/.claude" }])).toEqual([]);
  });

  it("drops entries without a config dir", () => {
    expect(parseLaunchProfiles([{ command: "cld", configDir: "  " }])).toEqual([]);
  });

  it("keeps the valid entries of a partly broken list", () => {
    const parsed = parseLaunchProfiles([
      { command: "no dir" },
      { command: "cld", configDir: "~/.claude" },
    ]);
    expect(parsed.map((p) => p.command)).toEqual(["cld"]);
  });

  it("returns nothing for a value that is not a list", () => {
    expect(parseLaunchProfiles({ command: "cld" })).toEqual([]);
    expect(parseLaunchProfiles(undefined)).toEqual([]);
  });
});

describe("profileForConfigDir", () => {
  it("finds the profile that owns the directory", () => {
    expect(profileForConfigDir([PERSO], "/Users/x/.claude-perso")).toBe(PERSO);
  });

  it("returns nothing when no profile matches", () => {
    expect(profileForConfigDir([PERSO], "/Users/x/.claude")).toBeUndefined();
  });

  it("returns nothing for an empty config dir", () => {
    expect(profileForConfigDir([PERSO], "")).toBeUndefined();
  });
});

describe("resolveLaunchPlan", () => {
  it("uses the profile command and suppresses the export when it owns the account", () => {
    expect(resolveLaunchPlan([PERSO], "/Users/x/.claude-perso", "")).toEqual({
      command: "cld-perso",
      exportConfigDir: "",
      unquoted: true,
    });
  });

  it("still exports the config dir for a profile that does not set it", () => {
    const wrapper: ClaudeLaunchProfile = { label: "W", command: "cld", configDir: "~/.claude" };
    expect(resolveLaunchPlan([wrapper], "/Users/x/.claude", "")).toEqual({
      command: "cld",
      exportConfigDir: "/Users/x/.claude",
      unquoted: true,
    });
  });

  it("prefers the profile over the configured executable path", () => {
    expect(resolveLaunchPlan([PERSO], "/Users/x/.claude-perso", "/opt/claude").command).toBe(
      "cld-perso",
    );
  });

  it("falls back to the executable path, which stays quotable", () => {
    expect(resolveLaunchPlan([], "/Users/x/.claude", "/opt/my claude/claude")).toEqual({
      command: "/opt/my claude/claude",
      exportConfigDir: "/Users/x/.claude",
      unquoted: false,
    });
  });

  it("falls back to a bare claude when nothing is configured", () => {
    expect(resolveLaunchPlan([], "", "")).toEqual({
      command: "claude",
      exportConfigDir: "",
      unquoted: true,
    });
  });
});

describe("launchOptionLabel", () => {
  it("marks the default account", () => {
    expect(launchOptionLabel(".claude", true)).toBe(".claude (default)");
  });

  it("names the command a profile will start", () => {
    expect(launchOptionLabel(".claude-perso", false, PERSO)).toBe(".claude-perso — cld-perso");
  });

  it("keeps both the default marker and the command", () => {
    expect(launchOptionLabel(".claude", true, { ...PERSO, command: "cld" })).toBe(
      ".claude (default) — cld",
    );
  });

  it("shows the bare account when no profile is configured", () => {
    expect(launchOptionLabel(".claude-perso", false)).toBe(".claude-perso");
  });
});

describe("resolveAgentLaunch", () => {
  it("uses the profile bound to the account's config dir", () => {
    expect(resolveAgentLaunch([PERSO], { configDir: "/Users/x/.claude-perso" })).toEqual({
      command: "cld-perso",
      exportConfigDir: "",
      unquoted: true,
    });
  });

  it("matches a profile for ~/.claude when the account carries no config dir", () => {
    const work: ClaudeLaunchProfile = { label: "W", command: "cld", configDir: "~/.claude" };

    expect(resolveAgentLaunch([work], {})).toEqual({
      command: "cld",
      // Empty: the account has no dir of its own, so the variable is unset —
      // which is what the default account needs anyway.
      exportConfigDir: "",
      unquoted: true,
    });
  });

  it("keeps exporting the account's dir for a profile that does not own it", () => {
    const work: ClaudeLaunchProfile = { label: "W", command: "cld", configDir: "~/.claude-work" };

    expect(resolveAgentLaunch([work], { configDir: "/Users/x/.claude-work" })).toEqual({
      command: "cld",
      exportConfigDir: "/Users/x/.claude-work",
      unquoted: true,
    });
  });

  it("falls back to the profile's executable path, quoted", () => {
    expect(resolveAgentLaunch([], { executablePath: "/opt/my claude/claude" })).toEqual({
      command: "/opt/my claude/claude",
      exportConfigDir: "",
      unquoted: false,
    });
  });

  it("falls back to a bare claude and clears the account", () => {
    expect(resolveAgentLaunch([], {})).toEqual({
      command: "claude",
      exportConfigDir: "",
      unquoted: true,
    });
  });

  it("does not let a profile for another account take over", () => {
    expect(resolveAgentLaunch([PERSO], { configDir: "/Users/x/.claude-work" }).command).toBe(
      "claude",
    );
  });
});

describe("loginShellArgs", () => {
  it("runs the command through an interactive login shell", () => {
    expect(loginShellArgs("cld-perso", [])).toEqual(["-i", "-l", "-c", "cld-perso"]);
  });

  it("leaves the command unquoted so an alias still expands", () => {
    expect(loginShellArgs("cld-perso", ["--print"])[3]).toBe("cld-perso '--print'");
  });

  it("quotes every argument, including one that looks like shell syntax", () => {
    expect(loginShellArgs("cld", ["--print", "; rm -rf /"])[3]).toBe("cld '--print' '; rm -rf /'");
  });

  it("escapes a single quote inside an argument", () => {
    expect(loginShellArgs("cld", ["it's"])[3]).toBe(`cld 'it'\\''s'`);
  });
});

describe("mergeLaunchProfiles", () => {
  const detected: ClaudeLaunchProfile = {
    label: "cld-perso",
    command: "cld-perso",
    configDir: "/Users/x/.claude-perso",
    ownsConfigDir: true,
  };

  it("adds an account that has no profile yet", () => {
    expect(mergeLaunchProfiles([], [detected])).toEqual([detected]);
  });

  it("keeps what the user configured for an account already covered", () => {
    // PERSO names the same account with `~`, and its command is the user's.
    expect(mergeLaunchProfiles([PERSO], [detected])).toEqual([PERSO]);
  });

  it("appends only the accounts that are missing", () => {
    const work: ClaudeLaunchProfile = { label: "W", command: "cld", configDir: "~/.claude" };

    expect(mergeLaunchProfiles([PERSO], [detected, work]).map((p) => p.configDir)).toEqual([
      "~/.claude-perso",
      "~/.claude",
    ]);
  });

  it("returns the configured list unchanged when nothing was detected", () => {
    expect(mergeLaunchProfiles([PERSO], [])).toEqual([PERSO]);
  });
});
