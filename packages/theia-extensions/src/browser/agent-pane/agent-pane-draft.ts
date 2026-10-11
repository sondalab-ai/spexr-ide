/** Where a workspace's unsent draft is kept. */
export interface DraftStorage {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

/** The storage key of a workspace's unsent draft. */
export const agentDraftKey = (rootUri: string): string => `spexr.agent.draft:${rootUri}`;

/** How long after the last keystroke the draft is kept. */
export const DRAFT_SAVE_MS = 400;

/**
 * The composer's unsent text, one per workspace, free of Theia and React.
 * - The first root the pane learns keeps whatever was typed before it was
 *   known; a switch to another root clears the field first, so one workspace's
 *   draft is never shown, or saved, under another's.
 * - A saved draft fills the field only if nothing has been typed since.
 * - After a send the field is cleared only if it still holds what was sent:
 *   words typed while the paste was in flight survive.
 * - It is written back shortly after the last keystroke, and at once on
 *   {@link flush} and {@link dispose}.
 */
export class DraftKeeper {
  text = "";
  private root: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly storage: DraftStorage,
    private readonly changed: () => void,
    private readonly timers: { set(fn: () => void, ms: number): ReturnType<typeof setTimeout>; clear(t: ReturnType<typeof setTimeout>): void } = { set: setTimeout, clear: clearTimeout },
  ) {}

  /** Learn the workspace root; load its draft the first time it is seen. */
  async switchRoot(root: string | undefined): Promise<void> {
    if (!root || this.root === root) return;
    this.flush();
    const switched = this.root !== undefined;
    this.root = root;
    if (switched) {
      this.text = "";
      this.changed();
    }
    try {
      const saved = await this.storage.get(agentDraftKey(root));
      if (typeof saved === "string" && this.root === root && this.text === "") {
        this.text = saved;
        this.changed();
      }
    } catch {
      /* storage unavailable: the draft starts empty */
    }
  }

  /** The user typed. */
  set(text: string): void {
    this.text = text;
    this.changed();
    if (this.timer) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => this.flush(), DRAFT_SAVE_MS);
  }

  /** A paste of `sent` went in: clear the field unless it has changed since. Returns whether it was cleared. */
  clearIfUnchanged(sent: string): boolean {
    if (this.text !== sent) return false;
    this.set("");
    return true;
  }

  /** Write the draft back now. */
  flush(): void {
    if (this.timer) this.timers.clear(this.timer);
    this.timer = undefined;
    if (!this.root) return;
    void this.storage.set(agentDraftKey(this.root), this.text).catch(() => undefined);
  }

  dispose(): void {
    this.flush();
  }
}
