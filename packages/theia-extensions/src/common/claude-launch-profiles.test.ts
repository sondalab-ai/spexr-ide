import { describe, expect, it } from "vitest";
import {
  accountForConfigDir,
  AMBIGUOUS_ACCOUNT,
  DEFAULT_ACCOUNT,
  DEFAULT_ACCOUNT_ID,
  isValidLaunchCommand,
  launchPlanFor,
  resolveAccount,
  launchOptionLabel,
  loginShellArgs,
  mergeLaunchProfiles,
  describeAddedProfiles,
  parseLaunchProfiles,
  profileForConfigDir,
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

describe("describeAddedProfiles", () => {
  it("names the commands and where to change them", () => {
    const message = describeAddedProfiles([PERSO]);

    expect(message).toContain("cld-perso");
    expect(message).toContain("spexr.claude.launchProfiles");
  });

  it("agrees in number with a single profile", () => {
    expect(describeAddedProfiles([PERSO])).toContain("1 Claude launch profile from");
  });

  it("agrees in number with several", () => {
    expect(describeAddedProfiles([PERSO, { ...PERSO, command: "cld" }])).toContain(
      "2 Claude launch profiles from",
    );
  });
});

describe("resolveAccount", () => {
  const WORK: ClaudeLaunchProfile = { label: "Work", command: "cld", configDir: "~/.claude-work" };

  it("falls back to the default account when nothing is configured", () => {
    expect(resolveAccount("", [])).toEqual(DEFAULT_ACCOUNT);
  });

  it("uses the only configured profile without asking", () => {
    expect(resolveAccount("", [PERSO])).toEqual({ profile: PERSO, configDir: "~/.claude-perso" });
  });

  it("reports ambiguity when several profiles exist and none was chosen", () => {
    expect(resolveAccount("", [PERSO, WORK])).toBe(AMBIGUOUS_ACCOUNT);
  });

  it("uses the chosen profile, named by its label", () => {
    expect(resolveAccount("Work", [PERSO, WORK])).toEqual({
      profile: WORK,
      configDir: "~/.claude-work",
    });
  });

  it("matches a label regardless of case and surrounding blanks", () => {
    expect(resolveAccount("  work ", [PERSO, WORK])).toEqual({
      profile: WORK,
      configDir: "~/.claude-work",
    });
  });

  it("honours an explicit choice of the default account over the profiles", () => {
    expect(resolveAccount(DEFAULT_ACCOUNT_ID, [PERSO, WORK])).toEqual(DEFAULT_ACCOUNT);
  });

  it("lets a profile the user labelled \"default\" win over the built-in account", () => {
    const named: ClaudeLaunchProfile = {
      label: "default",
      command: "cld",
      configDir: "~/.claude-work",
    };

    expect(resolveAccount(DEFAULT_ACCOUNT_ID, [named, WORK])).toEqual({
      profile: named,
      configDir: "~/.claude-work",
    });
  });

  it("re-asks when the chosen label no longer names a profile", () => {
    // A renamed or deleted profile leaves a dangling choice: falling through to
    // the quick-pick heals it, where honouring it silently would not.
    expect(resolveAccount("Gone", [PERSO, WORK])).toBe(AMBIGUOUS_ACCOUNT);
  });

  it("still uses the single profile when the chosen label is stale", () => {
    expect(resolveAccount("Gone", [PERSO])).toEqual({
      profile: PERSO,
      configDir: "~/.claude-perso",
    });
  });
});

describe("accountForConfigDir", () => {
  it("binds the profile that owns the config dir", () => {
    expect(accountForConfigDir([PERSO], "/Users/x/.claude-perso")).toEqual({
      profile: PERSO,
      configDir: "/Users/x/.claude-perso",
    });
  });

  it("keeps the config dir when no profile claims it", () => {
    expect(accountForConfigDir([PERSO], "/Users/x/.claude-work")).toEqual({
      configDir: "/Users/x/.claude-work",
    });
  });

  it("reads an empty config dir as the default account, matching no profile", () => {
    const home: ClaudeLaunchProfile = { label: "H", command: "cld", configDir: "~/.claude" };

    expect(accountForConfigDir([home], "")).toEqual(DEFAULT_ACCOUNT);
  });
});

describe("launchPlanFor", () => {
  it("runs the account's profile command, unquoted so an alias expands", () => {
    expect(launchPlanFor({ profile: PERSO, configDir: "~/.claude-perso" }, "")).toEqual({
      command: "cld-perso",
      // PERSO owns the account, so SPEXR must not export it too.
      exportConfigDir: "",
      unquoted: true,
    });
  });

  it("exports the config dir for a profile that does not own it", () => {
    const work: ClaudeLaunchProfile = { label: "W", command: "cld", configDir: "~/.claude-work" };

    expect(launchPlanFor({ profile: work, configDir: "/Users/x/.claude-work" }, "")).toEqual({
      command: "cld",
      exportConfigDir: "/Users/x/.claude-work",
      unquoted: true,
    });
  });

  it("leaves the default account unset rather than exporting ~/.claude", () => {
    const home: ClaudeLaunchProfile = { label: "H", command: "cld", configDir: "~/.claude" };

    expect(launchPlanFor({ profile: home, configDir: "~/.claude" }, "").exportConfigDir).toBe("");
  });

  it("falls back to the configured executable path, which stays quotable", () => {
    expect(launchPlanFor({ configDir: "/Users/x/.claude-work" }, "/opt/my claude/claude")).toEqual({
      command: "/opt/my claude/claude",
      exportConfigDir: "/Users/x/.claude-work",
      unquoted: false,
    });
  });

  it("falls back to a bare claude when nothing is configured", () => {
    expect(launchPlanFor(DEFAULT_ACCOUNT, "")).toEqual({
      command: "claude",
      exportConfigDir: "",
      unquoted: true,
    });
  });
});
