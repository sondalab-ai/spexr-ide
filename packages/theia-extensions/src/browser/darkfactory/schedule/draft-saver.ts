/**
 * Debounced saving of a draft the operator is typing into: saving every
 * keystroke over RPC made controlled inputs lag. Holds only the edit not yet
 * saved and its timer; the rendered draft stays in React state.
 */
export class DraftSaver<T> {
  private pending: { value: T } | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly save: (draft: T) => void,
    private readonly delayMs: number,
  ) {}

  /** Record an edit; it is saved once `delayMs` pass with no newer one. */
  edit(draft: T): void {
    this.pending = { value: draft };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  /** Save the pending edit now, if there is one (a blur, or leaving the schedule). */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) this.save(pending.value);
  }

  /** Forget the pending edit unsaved: its schedule was deleted or replaced. */
  discard(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }

  /** The pane is closing: an edit typed moments before is saved, not lost. */
  dispose(): void {
    this.flush();
  }
}
