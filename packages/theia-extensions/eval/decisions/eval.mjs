// Spec 0017 evaluation harness: routes every task in dataset.json to an expert
// through the app's own decision service (the built lib, the catalog's routing
// descriptions, the same option rotations), and prints accuracy, calibration
// and latency per model. It loads the vendored weights, so it is not part of
// CI: run it whenever the model, the descriptions or the service change, and
// paste its output into the PR.
//
//   pnpm --filter @spexr/theia-extensions build
//   pnpm --filter @spexr/theia-extensions eval:decisions [kev-4b] [kev-0.6b]
//
// SPEXR_MODELS_DIR overrides where the weights are read from.
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SpexrDecisionBackendService } = require("../../lib/node/decision/decision-backend-service.js");
const { EXPERT_CATALOG } = require("@spexr/agent");

const data = JSON.parse(fs.readFileSync(new URL("./dataset.json", import.meta.url), "utf8"));
const experts = EXPERT_CATALOG.filter((e) => new Set(data.map((d) => d.label)).has(e.id));
const question = {
  type: "choice",
  instructions: "Which expert should take this task?",
  options: experts.map((e) => e.id),
  descriptions: Object.fromEntries(experts.map((e) => [e.id, e.routingDescription ?? `${e.name}: ${e.description}`])),
};
const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9];
const pct = (x) => (Number.isNaN(x) ? "-" : `${Math.round(x * 100)}%`);
const acc = (rows) => (rows.length ? rows.filter((r) => r.got === r.label).length / rows.length : NaN);

const models = process.argv.slice(2).length ? process.argv.slice(2) : ["kev-4b", "kev-0.6b"];
const svc = new SpexrDecisionBackendService();
console.log(`${data.length} tasks, ${experts.length} experts: ${experts.map((e) => e.id).join(", ")}\n`);
for (const model of models) {
  await svc.setModel(model);
  const t0 = Date.now();
  const first = await svc.decide("warm up", question);
  if (!first) {
    console.log(`${model}: no decision — are its weights in the models directory?\n`);
    continue;
  }
  const loadMs = Date.now() - t0;
  const rows = [];
  for (const item of data) {
    const t = Date.now();
    const d = await svc.decide(item.text, question);
    rows.push({ ...item, got: d?.choice, conf: d?.confidence ?? 0, ms: Date.now() - t });
  }
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`${model}  (first decision incl. load ${loadMs} ms, median ${ms[Math.floor(ms.length / 2)]} ms)`);
  console.log(`  accuracy ${pct(acc(rows))}  en ${pct(acc(rows.filter((r) => r.lang === "en")))}  it ${pct(acc(rows.filter((r) => r.lang === "it")))}  real ${pct(acc(rows.filter((r) => r.src !== "synthetic")))}  synthetic ${pct(acc(rows.filter((r) => r.src === "synthetic")))}`);
  for (const th of THRESHOLDS) {
    const kept = rows.filter((r) => r.conf >= th);
    console.log(`  confidence >= ${th}: right ${pct(acc(kept))} on ${pct(kept.length / rows.length)} of tasks`);
  }
  const misses = rows.filter((r) => r.got !== r.label).map((r) => `${r.label}→${r.got}`);
  console.log(`  misses: ${misses.join(", ") || "none"}\n`);
}
process.exit(0);
