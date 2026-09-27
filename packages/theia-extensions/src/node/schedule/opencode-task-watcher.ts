import type { AgentTile } from "../../common/darkfactory-protocol.js";
import type { Turn, StateEntry } from "../darkfactory/session-state.js";
import { TurnTracker, finalReply } from "./turn-tracker.js";
import type { WatchEvent } from "./claude-task-watcher.js";

export const OPENCODE_SESSION_WAIT_MS = 120_000;
/** The wall's own poll interval: asking more often would re-run `opencode db` (see its memory note). */
export const SCAN_EVERY_MS = 20_000;

/** What the runner needs from the Dark Factory backend: its scans, not its own `opencode db` queries. */
export interface WallScanSource {
  onScanned(listener: (tiles: AgentTile[]) => void): () => void;
  requestScan(): void;
  knownSessionIds(): Set<string>;
  scanEntries(sessionId: string): Promise<unknown[]>;
}

const norm = (p: string): string => p.replace(/\/+$/, "") || p;

/** A tile's state as a turn reading: the wall already settled permission prompts. */
function turnOf(t: AgentTile): Turn {
  if (t.state === "working") return "acting";
  if (t.needsYouCertain) return "permission";
  if (t.needsYou) return "ended";
  return "unknown";
}

/**
 * Watch an opencode task through the wall's scans: adopt the first session in
 * its folder that the wall did not know at launch, then report its turn
 * transitions. Asks for a scan every SCAN_EVERY_MS so it moves with no window open.
 */
export function watchOpencodeTask(
  req: { workspace: string; permissionMode?: string },
  source: WallScanSource,
  deps: { now(): number; every(fn: () => Promise<void>): () => void },
  listener: (e: WatchEvent) => void,
): () => void {
  const known = source.knownSessionIds();
  const startedAt = deps.now();
  const tracker = new TurnTracker({
    ...(req.permissionMode !== undefined ? { permissionMode: req.permissionMode } : {}),
    settleMs: 0,
    armed: true,
  });
  let sessionId: string | undefined;
  let stopped = false;
  const stopScans = deps.every(async () => source.requestScan());
  const stopListening = source.onScanned((tiles) => {
    if (stopped) return;
    if (!sessionId) {
      const found = tiles.find((t) => t.harness === "opencode" && norm(t.projectPath) === norm(req.workspace) && !known.has(t.sessionId));
      if (!found) {
        if (deps.now() - startedAt >= OPENCODE_SESSION_WAIT_MS) {
          stop();
          listener({ type: "session-missing" });
        }
        return;
      }
      sessionId = found.sessionId;
      listener({ type: "session-found", sessionId });
    }
    const mine = tiles.find((t) => t.sessionId === sessionId);
    if (!mine) return;
    for (const signal of tracker.update(turnOf(mine), deps.now())) {
      if (signal.type !== "turn-ended") listener(signal);
      else
        void source
          .scanEntries(sessionId)
          .then((entries) => listener({ type: "turn-ended", reply: finalReply(entries as StateEntry[]) }));
    }
  });
  function stop(): void {
    stopped = true;
    stopScans();
    stopListening();
  }
  return stop;
}
