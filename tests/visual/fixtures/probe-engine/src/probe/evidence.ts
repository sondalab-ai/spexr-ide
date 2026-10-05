/** One thing a probe saw while it ran, with the moment it saw it. */
export interface Mark {
  readonly label: string;
  readonly at: number;
}

/** The append-only log a probe run writes into. */
export class Evidence {
  private readonly marks: Mark[] = [];

  constructor(readonly probeId: string) {}

  mark(label: string, at: number): void {
    this.marks.push({ label, at });
  }

  get length(): number {
    return this.marks.length;
  }

  toJSON(): { probeId: string; marks: readonly Mark[] } {
    return { probeId: this.probeId, marks: this.marks };
  }
}
