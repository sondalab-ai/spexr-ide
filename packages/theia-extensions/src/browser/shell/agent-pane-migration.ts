/** The `localStorage` key that records the agent pane has been revealed once. */
export const AGENT_PANE_MIGRATION_KEY = "spexr.migration.agent-pane.v1";

/**
 * Whether the agent pane is to be brought to the front of the right island now:
 * true the first time, on a fresh layout and on a layout saved before the pane
 * existed alike, and never again, so a user who put another view in front or
 * closed the pane is not overruled on every launch. The answer is recorded
 * when it is given; storage that cannot be read or written (private mode)
 * answers false, so a broken store never reveals it twice.
 */
export function takeAgentPaneReveal(storage: Pick<Storage, "getItem" | "setItem">): boolean {
  try {
    if (storage.getItem(AGENT_PANE_MIGRATION_KEY) !== null) return false;
    storage.setItem(AGENT_PANE_MIGRATION_KEY, "1");
    return storage.getItem(AGENT_PANE_MIGRATION_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * What the layout does with the agent pane at startup. A fresh layout opens it
 * (Theia's own default-layout hook does not: the view is not `openByDefault`);
 * a saved layout gets it opened and brought to the front once, through the
 * migration; after that nothing is done, so a pane the user closed stays
 * closed. The migration's flag is consumed in every case.
 */
export function agentPaneStartup(fresh: boolean, storage: Pick<Storage, "getItem" | "setItem">): { open: boolean } {
  const migrate = takeAgentPaneReveal(storage);
  return { open: fresh || migrate };
}
