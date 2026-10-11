/** Something to undo: a subscription. */
export interface Subscription {
  dispose(): void;
}

/**
 * The editors on each file URI, each with the subscriptions it made (S6c, E7).
 * A subscription belongs to its editor, not to the file: split a file, close
 * the original, and the copy keeps refreshing, because only the closed
 * editor's subscriptions go with it. When the last editor on a file goes,
 * `remove` says so, and the caller drops what it holds for the file.
 */
export class UriWatchers<W> {
  private readonly byUri = new Map<string, Map<W, Subscription[]>>();

  /** An editor joins a file; `subscribe` makes its subscriptions. Returns whether it is the file's first editor. */
  add(uri: string, widget: W, subscribe: () => Subscription[]): boolean {
    let widgets = this.byUri.get(uri);
    const first = !widgets;
    if (!widgets) this.byUri.set(uri, (widgets = new Map()));
    if (!widgets.has(widget)) widgets.set(widget, subscribe());
    return first;
  }

  /** An editor left: its subscriptions are disposed, the others' stay. Returns whether the file has no editor now. */
  remove(uri: string, widget: W): boolean {
    const widgets = this.byUri.get(uri);
    if (!widgets) return false;
    for (const sub of widgets.get(widget) ?? []) sub.dispose();
    widgets.delete(widget);
    if (widgets.size > 0) return false;
    this.byUri.delete(uri);
    return true;
  }

  /** The editors on a file, in the order they joined. */
  widgets(uri: string): W[] {
    return [...(this.byUri.get(uri)?.keys() ?? [])];
  }

  /** Every file with an editor. */
  uris(): string[] {
    return [...this.byUri.keys()];
  }
}
