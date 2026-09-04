import { homedir } from "node:os";
import { join } from "node:path";
import { readdirSync, statSync } from "node:fs";
import type { ClaudeConfigDir } from "../../common/darkfactory-protocol.js";

/** Injectable filesystem seams so discovery is unit-testable without a real home. */
export interface ConfigDirDeps {
  home?: string;
  listHome?: (home: string) => string[];
  hasProjects?: (dir: string) => boolean;
}

function defaultListHome(home: string): string[] {
  try {
    return readdirSync(home);
  } catch {
    return [];
  }
}

function defaultHasProjects(dir: string): boolean {
  try {
    return statSync(join(dir, "projects")).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Claude config directories to scan for sessions, discovered adaptively: every
 * `~/.claude*` directory that has a `projects/` subdir — so alias setups like
 * `.claude-perso` are found without any configuration — plus the default
 * `~/.claude` and any `CLAUDE_CONFIG_DIR` override. Deduplicated; a session lives
 * under exactly one config dir, and `claude --resume` must run against the one
 * that owns it.
 */
export function configDirs(env: NodeJS.ProcessEnv = process.env, deps: ConfigDirDeps = {}): string[] {
  const home = deps.home ?? homedir();
  const listHome = deps.listHome ?? defaultListHome;
  const hasProjects = deps.hasProjects ?? defaultHasProjects;

  const dirs = new Set<string>([join(home, ".claude")]);
  for (const name of listHome(home)) {
    if (name.startsWith(".claude") && hasProjects(join(home, name))) dirs.add(join(home, name));
  }
  const envDir = env.CLAUDE_CONFIG_DIR?.trim();
  if (envDir) dirs.add(envDir);
  return [...dirs];
}

/**
 * Describe discovered config dirs for the UI: each is named by its directory
 * (`.claude-perso`), and the one a bare `claude` would use leads the list so the
 * launcher's pre-selection needs no re-derivation in the frontend. The rest are
 * alphabetical, which keeps the order stable across scans.
 */
export function describeConfigDirs(dirs: readonly string[], defaultDir: string): ClaudeConfigDir[] {
  const described = dirs.map((path) => ({
    path,
    label: path.replace(/\/+$/, "").split("/").pop() || path,
    isDefault: path === defaultDir,
  }));
  return described.sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault) || a.label.localeCompare(b.label),
  );
}

/** The `projects` subdirectory that holds transcripts for a config dir. */
export function projectsDirOf(configDir: string): string {
  return join(configDir, "projects");
}
