/** A bottom-panel companion of the spec editor, as this policy needs to see it. */
export interface SpecCompanionPanel {
  isVisible(): boolean;
  reveal(): Promise<void>;
  close(): void;
}

/**
 * Decides whether the spec companion panels (linked resources, spec validation)
 * are on screen, keeping them scoped to spec editors.
 *
 * Only a change of spec acts. Revealing on every shell notification is what
 * made the panels steal the bottom tab bar: selecting Problems or a terminal
 * leaves the spec editor in front of the main area but drops the companion out
 * of `isVisible`, so an unconditional reconciliation read that as "closed" and
 * revealed it back over the tab the user had just picked.
 *
 * Panels are revealed in the given order, so the last one listed is the tab
 * left in front when a spec is opened.
 */
export class SpexrSpecCompanionPanelsPolicy {
  /** Spec the panels were last revealed for; `undefined` outside spec editors. */
  private lastSpecKey: string | undefined;

  /** Serializes reconciliations so a fast tab switch cannot interleave reveals. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly panels: readonly SpecCompanionPanel[]) {}

  /**
   * @param specKey Identity of the spec editor in front of the main area, or
   *   `undefined` when the main area shows anything else.
   */
  sync(specKey: string | undefined): Promise<void> {
    this.queue = this.queue.then(() => this.reconcile(specKey));
    return this.queue;
  }

  private async reconcile(specKey: string | undefined): Promise<void> {
    if (specKey === undefined) {
      this.lastSpecKey = undefined;
      for (const panel of this.panels) if (panel.isVisible()) panel.close();
      return;
    }
    if (specKey === this.lastSpecKey) return;
    this.lastSpecKey = specKey;
    for (const panel of this.panels) await panel.reveal();
  }
}
