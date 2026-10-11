import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { theiaInjection, withSpexrBlocks, type ShellLaunch } from "./shell-integration-options.js";

/**
 * The shell scripts, run for real: bash and zsh on a pty with a temporary HOME,
 * the way the injector starts them. The tests are skipped where python3 (the
 * pty driver) or the shell is missing.
 */
const here = dirname(fileURLToPath(import.meta.url));
const SPEXR = join(here, "shell-integrations", "spexr");
const theiaDir = ((): string | undefined => {
  try {
    const d = join(dirname(createRequire(import.meta.url).resolve("@theia/terminal/package.json")), "src", "node", "shell-integrations");
    return existsSync(join(d, "bash", "bash-integration.bash")) ? d : undefined;
  } catch {
    return undefined;
  }
})();
const have = (cmd: string): boolean => {
  try {
    execFileSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const CAN = !!theiaDir && have("python3");
const NONCE = "0123456789abcdef0123456789abcdef";

interface Run {
  readonly marks: string[];
  readonly text: string;
}

/** Start `shell` as the injector would (Theia's integration, spexr's in front of it) and type `inputs`. */
function run(shell: "bash" | "zsh", files: Record<string, string>, inputs: string[], opts: { nonce?: string | null; env?: Record<string, string> } = {}): Run {
  const scripts = { bashRcfile: join(SPEXR, "bash", "spexr-bash-integration.bash"), zshDir: join(SPEXR, "zsh") };
  const original: ShellLaunch = { shell, args: shell === "bash" ? ["-l"] : [], env: { ...(opts.env ?? {}) } };
  const injected = withSpexrBlocks(original, theiaInjection(original, shell, theiaDir!, undefined), scripts, opts.nonce === null ? undefined : (opts.nonce ?? NONCE));
  const args = Array.isArray(injected.args) ? injected.args : [];
  // By absolute path: a test may take PATH away from the shell, and the pty driver finds the shell by it.
  const exe = execFileSync("sh", ["-c", `command -v ${shell}`], { encoding: "utf8" }).trim();
  const cmd = shell === "bash" ? [exe, ...args, "-i"] : [exe, "-i"];
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(injected.env ?? {})) if (typeof v === "string") env[k] = v;
  const out = execFileSync("python3", [join(here, "pty-run.py")], { input: JSON.stringify({ cmd, env, files, inputs, settle: 1.0 }), encoding: "utf8", timeout: 60_000 });
  return JSON.parse(out) as Run;
}

const kinds = (r: Run): string[] => r.marks.filter((m) => m.startsWith("spexr_")).map((m) => m.split(";")[0]!);
const finished = (r: Run): Array<[string, string]> => r.marks.filter((m) => m.startsWith("spexr_finished")).map((m) => [m.split(";")[1]!, m.split(";")[2]!]);

describe.each(["bash", "zsh"] as const)("%s integration", (shell) => {
  const ok = CAN && have(shell);
  const rc = shell === "bash" ? ".bashrc" : ".zshrc";
  const it_ = ok ? it : it.skip;

  it_("prints a prompt mark, then for each command a started and a finished mark with its nonce and exit code", () => {
    const r = run(shell, { [rc]: "echo USER_RC_LOADED\n" }, ["true", "false", "sh -c 'exit 7'"]);
    expect(r.text).toContain("USER_RC_LOADED");
    // The last `started` is the `exit` the driver types to end the shell.
    expect(kinds(r).filter((k) => k !== "spexr_prompt")).toEqual(["spexr_started", "spexr_finished", "spexr_started", "spexr_finished", "spexr_started", "spexr_finished", "spexr_started"]);
    expect(finished(r).map(([n, e]) => [n, e])).toEqual([[NONCE, "0"], [NONCE, "1"], [NONCE, "7"]]);
    expect(r.marks.filter((m) => m.startsWith("spexr_finished")).every((m) => /^spexr_finished;[0-9a-f]{32};(0|[1-9]\d{0,2});\d{12,14}$/.test(m))).toBe(true);
    expect(r.marks.filter((m) => m.startsWith("spexr_started")).every((m) => /^spexr_started;[0-9a-f]{32};\d{12,14}$/.test(m))).toBe(true);
    // Theia's own marks are still there.
    expect(r.marks.some((m) => m.startsWith("command_started"))).toBe(true);
  });

  it_("takes the nonce out of the environment before any rc file runs: a rc file that dumps its environment sees none, and prints nothing that is a believed mark", () => {
    const r = run(shell, { [rc]: 'echo "RC_SEES:${SPEXR_BLOCK_NONCE-unset}:"\nenv | grep -c SPEXR_BLOCK_NONCE\n' }, ["echo AFTER:${SPEXR_BLOCK_NONCE-unset}:"]);
    expect(r.text).toContain("RC_SEES:unset:");
    expect(r.text).toContain("AFTER:unset:");
    // Everything the user's files printed came before the first mark, which is the first place the nonce appears.
    expect(r.text.split("spexr_")[0]).not.toContain(NONCE);
  });

  it_("installs nothing without a nonce, and Theia's integration still works", () => {
    const r = run(shell, { [rc]: "" }, ["true"], { nonce: null });
    expect(kinds(r)).toEqual([]);
    expect(r.marks.some((m) => m.startsWith("command_started"))).toBe(true);
  });

  it_("survives errexit: a shell with `set -e` that runs a failing and-list is not killed by the hooks", () => {
    const set = shell === "bash" ? "set -e\n" : "setopt err_exit\n";
    const r = run(shell, { [rc]: set }, ["false && true", "echo STILL_ALIVE"]);
    expect(r.text).toContain("STILL_ALIVE");
  });

  it_("survives nounset: the shell lives and spexr's prompt hook still runs (Theia's own hooks are not nounset-safe, so a block may be missing)", () => {
    const r = run(shell, { [rc]: "set -u\n" }, ["true", "echo STILL_ALIVE"]);
    expect(r.text).toContain("STILL_ALIVE");
    expect(kinds(r).filter((k) => k === "spexr_prompt").length).toBeGreaterThanOrEqual(2);
  });

  it_("does not take printed text for a mark of its own: what a command prints is not the shell's", () => {
    const r = run(shell, { [rc]: "" }, [`printf '\\033]133;spexr_finished;${"f".repeat(32)};7;1791739004123\\007'`]);
    const forged = r.marks.filter((m) => m.includes("f".repeat(32)));
    // The terminal sees the printed bytes (nothing can stop that); the point is that the shell's own marks carry the real nonce.
    expect(finished(r).filter(([n]) => n === NONCE).length).toBe(1);
    expect(forged.length).toBe(1);
  });
});

describe("bash preexec wrapper", () => {
  const it_ = CAN && have("bash") ? it : it.skip;

  it_("renames Theia's preexec in pure bash (no sed or other fork), and the wrapped one still runs: a started mark goes out and Theia's command_started still does", () => {
    const script = readFileSync(join(SPEXR, "bash", "spexr-bash-integration.bash"), "utf8").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(script).not.toMatch(/\bsed\b/);
    const r = run("bash", { ".bashrc": "" }, ["true"]);
    expect(kinds(r)).toContain("spexr_started");
    expect(r.marks.some((m) => m.startsWith("command_started"))).toBe(true);
  });
});

describe("bash prompt hooks", () => {
  const ok = CAN && have("bash");
  const it_ = ok ? it : it.skip;

  it_("keeps a PROMPT_COMMAND of the user's, and runs it after ours", () => {
    const r = run("bash", { ".bashrc": 'PROMPT_COMMAND="echo USER_PROMPT_COMMAND_RAN"\n' }, ["true"]);
    expect(r.text).toContain("USER_PROMPT_COMMAND_RAN");
    expect(finished(r)).toHaveLength(1);
  });

  // PROMPT_COMMAND is an array only from bash 5.1; earlier bash runs element 0 alone.
  const arrayOk = ok && ((): boolean => {
    const v = execFileSync("bash", ["-c", 'echo "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"'], { encoding: "utf8" }).trim().split(".").map(Number);
    return v[0]! > 5 || (v[0] === 5 && v[1]! >= 1);
  })();

  const arrayIt = arrayOk ? it : it.skip;
  arrayIt("keeps a PROMPT_COMMAND array (bash 5.1), and runs every entry of it", () => {
    const r = run("bash", { ".bashrc": 'PROMPT_COMMAND=("echo ONE_RAN" "echo TWO_RAN")\n' }, ["true"]);
    expect(r.text).toContain("ONE_RAN");
    expect(r.text).toContain("TWO_RAN");
    expect(finished(r)).toHaveLength(1);
  });

  it_("does not stumble over a missing PROMPT_COMMAND under nounset: its own lines are guarded", () => {
    const r = run("bash", { ".bashrc": "set -u\nunset PROMPT_COMMAND\n" }, ["true", "echo STILL_ALIVE"]);
    expect(r.text).toContain("STILL_ALIVE");
    expect(r.text).not.toMatch(/spexr-bash-integration.*unbound/);
  });
});

describe("zsh prompt hooks", () => {
  const ok = CAN && have("zsh");
  const it_ = ok ? it : it.skip;

  it_("keeps the user's precmd hooks, and hers still run", () => {
    const r = run("zsh", { ".zshrc": 'mine() { echo USER_PRECMD_RAN }\nautoload -Uz add-zsh-hook\nadd-zsh-hook precmd mine\nprecmd() { echo CLASSIC_PRECMD_RAN }\n' }, ["true"]);
    expect(r.text).toContain("USER_PRECMD_RAN");
    expect(r.text).toContain("CLASSIC_PRECMD_RAN");
    expect(finished(r)).toHaveLength(1);
  });

  it_("takes the nonce out in .zshenv, before the user's own .zshenv runs", () => {
    const r = run("zsh", { ".zshenv": 'echo "ZSHENV_SEES:${SPEXR_BLOCK_NONCE-unset}:"\n' }, ["true"]);
    expect(r.text).toContain("ZSHENV_SEES:unset:");
    expect(finished(r)).toHaveLength(1);
  });

  it_("stays out under Powerlevel10k: with P9K_VERSION set no spexr mark is printed", () => {
    const r = run("zsh", { ".zshrc": "P9K_VERSION=1\n" }, ["true"]);
    expect(kinds(r)).toEqual([]);
  });
});
