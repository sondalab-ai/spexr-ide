import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Claude config directories to scan for sessions, in priority order:
 * the default `~/.claude` plus `CLAUDE_CONFIG_DIR` when set (a session lives
 * under exactly one config dir, and `claude --resume` must run against the
 * config dir that owns it). Deduplicated.
 */
export function configDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs = [join(homedir(), ".claude")];
  const envDir = env.CLAUDE_CONFIG_DIR?.trim();
  if (envDir) dirs.push(envDir);
  return [...new Set(dirs)];
}

/** The `projects` subdirectory that holds transcripts for a config dir. */
export function projectsDirOf(configDir: string): string {
  return join(configDir, "projects");
}
