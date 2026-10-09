import { applyDelta } from "../../common/agent-pane-apply.js";
import type { AgentPaneDelta, AgentPaneService, AgentPaneSnapshot } from "../../common/agent-pane-protocol.js";

/** What the controller asks of the agent terminal's manager. */
export interface PaneTerminal {
  agentRootUri(): string | undefined;
  /** The id of the session the running agent was started with. */
  currentSessionId(): string | undefined;
  /** The id the last launch for a workspace used, kept across restarts. */
  storedSessionId(rootUri: string): Promise<string | undefined>;
  /** The pane followed the conversation to a successor: remember it as the agent's session. */
  adoptSessionId(rootUri: string, sessionId: string): void;
}

/** Deltas held while the snapshot they apply to is still on its way. */
const MAX_PENDING_DELTAS = 64;

/**
 * The agent pane's lifecycle, free of Theia and React: which session it
 * follows and what it holds of it.
 *
 * - {@link bind} picks the session (the running agent's, else the stored id
 *   marked `fromStorage`), and asks the service to follow it. A later bind
 *   makes an earlier one that is still waiting drop its result, so overlapping
 *   binds end on the latest; a follow that failed is forgotten, so the next
 *   bind tries again.
 * - A snapshot or delta for any other session is dropped. A delta that
 *   arrives before the snapshot it extends (the push can beat the answer to
 *   `follow`) is held and applied on it.
 * - On adoption (`/clear`, `/resume`) it follows the successor, starts it
 *   folded, and remembers it as the agent's session.
 */
export class AgentPaneController {
  snapshot: AgentPaneSnapshot | undefined;
  /** The session asked of the backend. */
  followed: string | undefined;
  /** The tool card shows every row. */
  expanded = false;

  /** Orders the lookups of the session id: the latest bind's answer is the one acted on. */
  private lookup = 0;
  /** Changes with the session followed, and only then: an answer for an earlier session is dropped, one for the same session is kept. */
  private session = 0;
  private pending: AgentPaneDelta[] = [];

  constructor(
    private readonly service: AgentPaneService,
    private readonly terminal: PaneTerminal,
    /** A workspace folder's URI as the path the backend reads. */
    private readonly toPath: (uri: string) => string,
    private readonly changed: () => void,
    private readonly warn: (message: string, error: unknown) => void = () => undefined,
  ) {}

  async bind(): Promise<void> {
    const lookup = ++this.lookup;
    const rootUri = this.terminal.agentRootUri();
    const running = this.terminal.currentSessionId();
    const sessionId = running ?? (rootUri ? await this.terminal.storedSessionId(rootUri).catch(() => undefined) : undefined);
    if (lookup !== this.lookup) return;
    if (!rootUri || !sessionId) {
      const had = this.followed !== undefined;
      this.reset(undefined);
      if (had) this.changed();
      await this.service.stop().catch(() => undefined);
      return;
    }
    if (sessionId === this.followed) return;
    this.reset(sessionId);
    const session = this.session;
    this.changed();
    try {
      const first = await this.service.follow({
        sessionId,
        workspacePath: this.toPath(rootUri),
        // An id from storage may be a session that ended: the backend then adopts a newer transcript only while a Claude runs there.
        ...(running ? {} : { fromStorage: true }),
      });
      if (session !== this.session) return;
      if (first && !this.snapshot) this.accept(first);
    } catch (err) {
      // Forgotten, so the next bind follows it again.
      if (session === this.session && this.followed === sessionId) this.followed = undefined;
      this.warn("the agent pane could not follow its session", err);
    }
  }

  snapshotPushed(snapshot: AgentPaneSnapshot): void {
    if (snapshot.sessionId !== this.followed) return;
    this.accept(snapshot);
  }

  deltaPushed(delta: AgentPaneDelta): void {
    if (delta.sessionId !== this.followed) return;
    if (!this.snapshot) {
      if (this.pending.length < MAX_PENDING_DELTAS) this.pending.push(delta);
      return;
    }
    this.snapshot = applyDelta(this.snapshot, delta);
    this.changed();
  }

  adopted(from: string, to: string): void {
    if (from !== this.followed) return;
    this.reset(to);
    const root = this.terminal.agentRootUri();
    if (root) this.terminal.adoptSessionId(root, to);
    this.changed();
  }

  toggleExpanded(): void {
    this.expanded = !this.expanded;
    this.changed();
  }

  /** Let go: nothing more arrives, and a late answer is dropped. */
  dispose(): void {
    this.session++;
    this.lookup++;
    void this.service.stop().catch(() => undefined);
  }

  private accept(snapshot: AgentPaneSnapshot): void {
    let next = snapshot;
    for (const d of this.pending) next = applyDelta(next, d);
    this.pending = [];
    this.snapshot = next;
    this.changed();
  }

  private reset(sessionId: string | undefined): void {
    this.session++;
    this.followed = sessionId;
    this.snapshot = undefined;
    this.pending = [];
    this.expanded = false;
  }
}
