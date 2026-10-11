/**
 * Which of a tree's nodes have a decoration the file-tree adapter has not
 * been told of (S6b, L7). The adapter learns from the decorations service's
 * change events only, so an Explorer created after git's status arrived has
 * to ask. Nodes the service has nothing for are remembered, so a tree with
 * thousands of plain files costs one query each, not one per redraw; a change
 * event from the service makes the adapter {@link forget} them, since that is
 * when one of them could have gained a decoration.
 */
export class MissingDecorations {
  private readonly none = new Set<string>();

  /** Forget the nodes found to have no decoration: the service reported a change. */
  forget(): void {
    this.none.clear();
  }

  /**
   * The keys among `keys` that the service decorates and the adapter does not
   * know, asking the service only about keys neither known nor found plain.
   */
  find(keys: Iterable<string>, known: (key: string) => boolean, decorated: (key: string) => boolean): string[] {
    const missing: string[] = [];
    for (const key of keys) {
      if (known(key) || this.none.has(key)) continue;
      if (decorated(key)) missing.push(key);
      else this.none.add(key);
    }
    return missing;
  }
}
