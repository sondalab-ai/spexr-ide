/**
 * A persona preset that parametrises a Claude session.
 *
 * `systemPrompt` is appended to SPEXR's base prompt via
 * `--append-system-prompt-file`. `model` is optional; when omitted the CLI
 * default model is used. The same shape backs both the built-in catalog and
 * future user-authored experts stored under `docs/agents/`.
 */
export interface ExpertAgent {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly model?: string;
  /**
   * Optional prompt typed into the session automatically right after the
   * expert is launched, once the CLI is ready for input. Lets an expert kick
   * off its work (e.g. produce a report) without the user typing anything.
   */
  readonly kickoffPrompt?: string;
  /**
   * How the local decision model tells this expert apart when routing a task
   * (spec 0017). Written for the model, naming the kinds of work the expert
   * takes, and measured: kev-4b routed 83% of the evaluation set right with
   * these, 75% with the user-facing `description`. Change it only with the
   * evaluation harness re-run.
   */
  readonly routingDescription?: string;
}
