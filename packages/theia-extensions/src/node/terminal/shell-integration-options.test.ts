import { describe, expect, it } from "vitest";
import { isCommandRun, theiaInjection, unpackedPath, withSpexrBlocks, type ShellLaunch } from "./shell-integration-options.js";

const NONCE = "0123456789abcdef0123456789abcdef";
const SCRIPTS = { bashRcfile: "/s/bash/spexr-bash-integration.bash", zshDir: "/s/zsh" };

describe("isCommandRun", () => {
  it("is true for -c however it is combined, as an agent or session launch is, and for a string of args", () => {
    expect(isCommandRun(["-i", "-l", "-c", "claude"])).toBe(true);
    expect(isCommandRun(["-lc", "claude"])).toBe(true);
    expect(isCommandRun(["-ic", "claude"])).toBe(true);
    expect(isCommandRun("-i -c claude")).toBe(true);
  });

  it("is false for a plain interactive shell", () => {
    expect(isCommandRun(undefined)).toBe(false);
    expect(isCommandRun([])).toBe(false);
    expect(isCommandRun(["-l"])).toBe(false);
    expect(isCommandRun(["--login", "-i"])).toBe(false);
  });
});

describe("withSpexrBlocks", () => {
  it("puts spexr's rcfile in front of Theia's for bash, and hands Theia's over", () => {
    const original: ShellLaunch = { shell: "/bin/bash", args: ["-l"], env: { A: "1" } };
    const injected: ShellLaunch = { ...original, args: ["--rcfile", "/theia/bash/bash-integration.bash"] };
    expect(withSpexrBlocks(original, injected, SCRIPTS, NONCE)).toEqual({
      shell: "/bin/bash",
      args: ["--rcfile", "/s/bash/spexr-bash-integration.bash"],
      env: { A: "1", SPEXR_THEIA_BASH_RCFILE: "/theia/bash/bash-integration.bash", SPEXR_BLOCK_NONCE: NONCE },
    });
  });

  it("keeps the rest of bash's arguments after the rcfile", () => {
    const original: ShellLaunch = { shell: "/bin/bash", args: ["-i"] };
    const injected: ShellLaunch = { ...original, args: ["--rcfile", "/theia/b.bash", "-i"] };
    expect(withSpexrBlocks(original, injected, SCRIPTS, NONCE).args).toEqual(["--rcfile", "/s/bash/spexr-bash-integration.bash", "-i"]);
  });

  it("points zsh's THEIA_ZSH_DIR at spexr's directory and keeps Theia's ZDOTDIR and its own directory in SPEXR_THEIA_ZSH_DIR", () => {
    const original: ShellLaunch = { shell: "/bin/zsh", env: { A: "1" } };
    const injected: ShellLaunch = { ...original, env: { A: "1", ZDOTDIR: "/theia/zsh/zdotdir/", THEIA_ZSH_DIR: "/theia/zsh", THEIA_ORIGINAL_ZDOTDIR: "" } };
    expect(withSpexrBlocks(original, injected, SCRIPTS, NONCE).env).toEqual({
      A: "1",
      ZDOTDIR: "/theia/zsh/zdotdir/",
      THEIA_ZSH_DIR: "/s/zsh",
      SPEXR_THEIA_ZSH_DIR: "/theia/zsh",
      THEIA_ORIGINAL_ZDOTDIR: "",
      SPEXR_BLOCK_NONCE: NONCE,
    });
  });

  it("changes nothing when Theia injected nothing: fish, PowerShell, a missing script", () => {
    const original: ShellLaunch = { shell: "/usr/bin/fish", args: ["-l"] };
    expect(withSpexrBlocks(original, original, SCRIPTS, NONCE)).toBe(original);
  });

  it("gives a shell that runs a command (the agent terminal, a Dark Factory session) no blocks at all: Theia's own integration is dropped too", () => {
    const original: ShellLaunch = { shell: "/bin/bash", args: ["-i", "-l", "-c", "claude"] };
    const injected: ShellLaunch = { ...original, args: ["--rcfile", "/theia/b.bash", "-i", "-c", "claude"] };
    expect(withSpexrBlocks(original, injected, SCRIPTS, NONCE)).toBe(original);
  });

  it("leaves Theia's integration as it is when spexr's script is not shipped", () => {
    const original: ShellLaunch = { shell: "/bin/bash" };
    const injected: ShellLaunch = { ...original, args: ["--rcfile", "/theia/b.bash"] };
    expect(withSpexrBlocks(original, injected, { bashRcfile: undefined, zshDir: undefined }, NONCE)).toBe(injected);
    const z: ShellLaunch = { ...original, env: { THEIA_ZSH_DIR: "/theia/zsh" } };
    expect(withSpexrBlocks(original, z, { bashRcfile: undefined, zshDir: undefined }, NONCE)).toBe(z);
  });
});

describe("unpackedPath", () => {
  const asar = "/Applications/spexr.app/Contents/Resources/app.asar/lib/backend/shell-integrations/bash/bash-integration.bash";
  const twin = "/Applications/spexr.app/Contents/Resources/app.asar.unpacked/lib/backend/shell-integrations/bash/bash-integration.bash";

  it("goes by the unpacked twin of a file inside the asar, which a shell can read", () => {
    expect(unpackedPath(asar, (p) => p === twin)).toBe(twin);
  });

  it("keeps the path when there is no twin, or no asar in it", () => {
    expect(unpackedPath(asar, () => false)).toBe(asar);
    expect(unpackedPath("/repo/lib/backend/a.bash", () => true)).toBe("/repo/lib/backend/a.bash");
  });

  it("is applied to zsh's ZDOTDIR too: a shell cannot read it inside the asar, and would lose the user's rc files and history", () => {
    const zAsar = "/App/Resources/app.asar/lib/backend/shell-integrations/zsh/zdotdir/";
    const zTwin = "/App/Resources/app.asar.unpacked/lib/backend/shell-integrations/zsh/zdotdir/";
    const original: ShellLaunch = { shell: "/bin/zsh", env: {} };
    const injected: ShellLaunch = { ...original, env: { ZDOTDIR: zAsar, THEIA_ZSH_DIR: "/App/Resources/app.asar/lib/backend/shell-integrations/zsh" } };
    const real = (p: string): string => unpackedPath(p, () => true);
    const out = withSpexrBlocks(original, injected, { ...SCRIPTS, real }, NONCE);
    expect(out.env?.ZDOTDIR).toBe(zTwin);
    expect(out.env?.SPEXR_THEIA_ZSH_DIR).toBe("/App/Resources/app.asar.unpacked/lib/backend/shell-integrations/zsh");
  });

  it("installs nothing, and leaves Theia's integration, when there is no nonce (the setting is off)", () => {
    const original: ShellLaunch = { shell: "/bin/bash" };
    const injected: ShellLaunch = { ...original, args: ["--rcfile", "/theia/b.bash"] };
    expect(withSpexrBlocks(original, injected, SCRIPTS, undefined)).toBe(injected);
  });

  it("is applied to Theia's own script and directory, which spexr hands on", () => {
    const original: ShellLaunch = { shell: "/bin/bash" };
    const injected: ShellLaunch = { ...original, args: ["--rcfile", asar] };
    const real = (p: string): string => unpackedPath(p, (x) => x === twin);
    expect(withSpexrBlocks(original, injected, { ...SCRIPTS, real }, NONCE).env?.SPEXR_THEIA_BASH_RCFILE).toBe(twin);
  });
});

describe("theiaInjection (Theia's own, from the package's sources, for a run without a bundle)", () => {
  it("starts bash with Theia's rcfile and without the login flag, which conflicts with --rcfile", () => {
    const out = theiaInjection({ shell: "/bin/bash", args: ["-l", "-i"] } as ShellLaunch, "bash", "/pkg/src/node/shell-integrations", undefined);
    expect(out.args).toEqual(["--rcfile", "/pkg/src/node/shell-integrations/bash/bash-integration.bash", "-i"]);
    expect(theiaInjection({ args: "-l --login" } as ShellLaunch, "bash", "/d", undefined).args).toEqual(["--rcfile", "/d/bash/bash-integration.bash"]);
    expect(theiaInjection({} as ShellLaunch, "bash", "/d", undefined).args).toEqual(["--rcfile", "/d/bash/bash-integration.bash"]);
  });

  it("gives zsh Theia's ZDOTDIR and directory, and keeps the user's ZDOTDIR to put back", () => {
    expect(theiaInjection({ env: { A: "1" } } as ShellLaunch, "zsh", "/d", "/home/u/zdot").env).toEqual({ A: "1", ZDOTDIR: "/d/zsh/zdotdir/", THEIA_ZSH_DIR: "/d/zsh", THEIA_ORIGINAL_ZDOTDIR: "/home/u/zdot" });
    expect(theiaInjection({ env: { ZDOTDIR: "/mine" } } as ShellLaunch, "zsh", "/d", "/home/u/zdot").env?.THEIA_ORIGINAL_ZDOTDIR).toBe("/mine");
    expect(theiaInjection({} as ShellLaunch, "zsh", "/d", undefined).env?.THEIA_ORIGINAL_ZDOTDIR).toBe("");
  });

  it("is what withSpexrBlocks then builds on: the two together put spexr's script in front of Theia's", () => {
    const original: ShellLaunch = { shell: "/bin/bash", args: ["-l"] };
    const injected = theiaInjection(original, "bash", "/d", undefined);
    expect(withSpexrBlocks(original, injected, SCRIPTS, NONCE)).toMatchObject({ args: ["--rcfile", "/s/bash/spexr-bash-integration.bash"], env: { SPEXR_THEIA_BASH_RCFILE: "/d/bash/bash-integration.bash" } });
  });

  it("changes nothing for another shell", () => {
    const o: ShellLaunch = { shell: "/usr/bin/fish" };
    expect(theiaInjection(o, undefined, "/d", undefined)).toBe(o);
  });
});
