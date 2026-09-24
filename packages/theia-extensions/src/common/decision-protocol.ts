/**
 * Typed decisions (spec 0017): a small local model answers a closed question
 * about a piece of text with a calibrated probability, never generated text.
 * The shapes follow open-jev's, but are declared here so the library behind
 * the service can change without touching its callers.
 */

export const DECISION_SERVICE_PATH = "/services/spexr/decisions";

/** The decision models SPEXR offers, or `off`. */
export type DecisionModel = "kev-4b" | "kev-0.6b" | "off";
export type DecisionModelOn = Exclude<DecisionModel, "off">;

export const DEFAULT_DECISION_MODEL: DecisionModel = "kev-4b";

/** Hugging Face repo each model is vendored from (see scripts/fetch-search-model.mjs). */
export const DECISION_MODEL_REPOS: Readonly<Record<DecisionModelOn, string>> = {
  "kev-4b": "onnx-community/kev-4b-ONNX",
  "kev-0.6b": "onnx-community/kev-0.6b-ONNX",
};

/**
 * Confidence at or above which a caller may act without asking, per model.
 * Measured (spec 0017, Evidence): kev-4b at 0.7 was right on 97% of the items
 * it decided alone; kev-0.6b needs 0.8 to reach 85%.
 */
export const AUTO_DECISION_THRESHOLD: Readonly<Record<DecisionModelOn, number>> = {
  "kev-4b": 0.7,
  "kev-0.6b": 0.8,
};

export function isDecisionModel(value: unknown): value is DecisionModel {
  return value === "kev-4b" || value === "kev-0.6b" || value === "off";
}

/** Pick one of up to 255 options; `descriptions` explain an option to the model. */
export interface ChoiceQuestion {
  readonly type: "choice";
  readonly instructions: string;
  readonly options: readonly string[];
  readonly descriptions?: Readonly<Record<string, string>>;
}

/** Rate on 2–10 ordered levels, lowest first. */
export interface ScoreQuestion {
  readonly type: "score";
  readonly instructions: string;
  readonly options: readonly string[];
}

/** Does the statement hold for the text? */
export interface NoulQuestion {
  readonly type: "noul";
  readonly instructions: string;
}

export type DecisionQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;

export interface ChoiceDecision {
  readonly type: "choice";
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface ScoreDecision {
  readonly type: "score";
  readonly score: number;
  readonly normalized: number;
  readonly level: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface NoulDecision {
  readonly type: "noul";
  readonly answer: boolean;
  readonly probability: number;
  readonly confidence: number;
}

/** A model answer to one question. */
export type DecisionAnswer = ChoiceDecision | ScoreDecision | NoulDecision;

/** The answer, tagged with the model that gave it (thresholds are per model). */
export type Decision = DecisionAnswer & { readonly model: DecisionModelOn };

export interface SpexrDecisionService {
  /**
   * Answer one typed question about `state`. Undefined when no decision can be
   * made — decisions are off, the model's weights are missing, it failed or
   * took too long — which callers treat as "leave things as they are". Never
   * rejects.
   */
  decide(state: string, question: DecisionQuestion): Promise<Decision | undefined>;
  /** Switch model; the next decision uses it. */
  setModel(model: DecisionModel): Promise<void>;
}
