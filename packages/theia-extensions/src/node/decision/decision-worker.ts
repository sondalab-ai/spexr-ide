// Runs the decision model (spec 0017) in its own child process, like the
// generation worker: onnxruntime's inference is a synchronous native call, and
// in the backend process it would stall every RPC for up to a second. The
// model is loaded on the first request and answers one request at a time.
import { env } from "@huggingface/transformers";
import { OpenJev, type Question } from "open-jev";
import type { DecisionWorkerRequest, DecisionWorkerResponse } from "./decision-backend-service.js";

const repo = process.env.SPEXR_DECISION_REPO ?? "";
// Vendored weights only: a decision never reaches the network.
env.allowRemoteModels = false;
env.localModelPath = process.env.SPEXR_MODELS_DIR ?? "";

process.on("disconnect", () => process.exit(0));

let loading: Promise<OpenJev> | undefined;

function post(msg: DecisionWorkerResponse): void {
  process.send?.(msg);
}

process.on("message", (req: DecisionWorkerRequest) => {
  void (async () => {
    try {
      const t0 = Date.now();
      loading ??= OpenJev.load({ model: repo, device: "cpu", dtype: "q4" });
      const jev = await loading;
      const [answer] = await jev.decide(req.state, [req.question as Question]);
      console.error(`[spexr decisions] ${req.question.type} decided in ${Date.now() - t0}ms`);
      post({ id: req.id, type: "done", answer: answer as never });
    } catch (err) {
      post({ id: req.id, type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  })();
});
