import { basename } from "node:path";
import { distillAction, lastActionFailed, recentActions } from "./action-distiller.js";
import type { TurnEntry } from "./turns.js";
import type { HarnessId, ParsedTranscript } from "../../common/harness/harness-types.js";
import type { AgentState, AgentTile } from "../../common/darkfactory-protocol.js";
import { CACHE_TTL_MS } from "../../common/darkfactory-protocol.js";

/** Palette slots the frontend cycles through, keyed off the project path. */
const PALETTE_SIZE = 8;

export interface TileInput {
  sessionId: string;
  harness: HarnessId;
  transcriptPath: string;
  projectPath: string;
  mtimeMs: number;
  entries: TurnEntry[];
  parsed: ParsedTranscript;
  state: AgentState;
  needsYou: boolean;
  needsYouCertain: boolean;
  hashToIndex(value: string, buckets: number): number;
  /** The name the user gave this session, if any. */
  customName?: string;
}

/**
 * Build one wall card from a parsed session. Shared by the wall scan and by
 * search, so a session found by query renders exactly like one on the wall.
 */
export function buildTile(input: TileInput): AgentTile {
  const { entries, parsed: p } = input;
  const action = distillAction(entries);
  return {
    sessionId: input.sessionId,
    harness: input.harness,
    transcriptPath: input.transcriptPath,
    projectPath: input.projectPath,
    projectName: basename(input.projectPath),
    state: input.state,
    needsYou: input.needsYou,
    needsYouCertain: input.needsYouCertain,
    lastFailed: lastActionFailed(entries),
    goal: p.goal || p.lastPrompt,
    actionLine: action.line,
    recentActions: recentActions(entries, 4),
    lastActivityMs: input.mtimeMs,
    turnCount: p.userTurns,
    accentId: input.hashToIndex(input.projectPath, PALETTE_SIZE),
    ...(action.tool !== undefined ? { tool: action.tool } : {}),
    ...(action.target !== undefined ? { target: action.target } : {}),
    ...(p.gitBranch !== undefined ? { gitBranch: p.gitBranch } : {}),
    ...(p.mode !== undefined ? { mode: p.mode } : {}),
    ...(p.permissionMode !== undefined ? { permissionMode: p.permissionMode } : {}),
    ...(input.customName ? { customName: input.customName } : {}),
    ...(p.cache
      ? {
          contextTokens: p.cache.contextTokens,
          cacheDeadlineMs: p.cache.lastRequestMs + CACHE_TTL_MS,
        }
      : {}),
  };
}
