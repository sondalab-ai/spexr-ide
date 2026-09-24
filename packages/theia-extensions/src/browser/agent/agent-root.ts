/**
 * Where the side agent should run, decided without asking when possible:
 * - `known`: a folder the caller already determined (a spec's folder);
 * - `among`: the folders an expert is installed in, when starting one;
 * - `hint`: the folder of the file being edited, pre-selected when asking.
 * All values are workspace-root URI strings.
 */
export type AgentRootChoice =
  | { readonly kind: "none" }
  | { readonly kind: "root"; readonly root: string }
  | { readonly kind: "ask"; readonly candidates: readonly string[]; readonly preselect?: string };

export function chooseAgentRoot(input: {
  readonly roots: readonly string[];
  readonly known?: string;
  readonly among?: readonly string[];
  readonly hint?: string;
}): AgentRootChoice {
  const { roots, known, among, hint } = input;
  if (roots.length === 0) return { kind: "none" };
  if (known !== undefined && roots.includes(known)) return { kind: "root", root: known };
  const installed = among?.filter((r) => roots.includes(r)) ?? [];
  const candidates = installed.length > 0 ? installed : roots;
  if (candidates.length === 1) return { kind: "root", root: candidates[0]! };
  return hint !== undefined && candidates.includes(hint)
    ? { kind: "ask", candidates, preselect: hint }
    : { kind: "ask", candidates };
}

/**
 * The folder a launch with no folder of its own (startup, "Talk to the agent")
 * uses: the one the agent last ran in, while it is still part of the
 * workspace, otherwise the first folder.
 */
export function rememberedRoot(roots: readonly string[], remembered: string | undefined): string | undefined {
  return remembered !== undefined && roots.includes(remembered) ? remembered : roots[0];
}

/**
 * Whether running a spec action in `target` would restart an agent that is
 * running in another folder, which the user is asked to confirm first.
 */
export function movesAgent(running: string | undefined, target: string | undefined): boolean {
  return running !== undefined && target !== undefined && running !== target;
}
