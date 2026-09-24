---
slug: 0017-decision-service
title: Decision service — a small local model for typed decisions
status: draft
createdAt: 2026-09-24
workflowStep: plan
---
> **What is this file.** Implementation contract for a shared, local "decision"
> service: SPEXR asks a small on-device model a typed question (pick one of
> these options, yes or no, rate on a scale) and gets back a calibrated
> probability, never generated text. Audience: SPEXR contributors. Owner:
> marcello.barile. Companion: `docs/specs/0016-card-browser.md` is unrelated;
> the TODO view (https://github.com/sondalab-ai/spexr-ide/pull/48) is the first
> consumer and its expert routing moves onto this service. The evaluation that
> chose the model is recorded below under **Evidence**; its harness ships with
> the service so any later model change is re-measured, not guessed.

## Goal

SPEXR keeps needing small decisions it can make on the machine, without a
network call and in a few seconds at most: which expert should take a TODO item;
later, whether a session needs the user, which workflow step a request belongs
to, what kind of commit a change is. These are closed questions over a known set
of answers. A generative model is the wrong tool for them: it can answer
something that is not an option, it gives no confidence, and SPEXR's generative
model is shared with the wall's summaries.

This spec adds a decision service in the shape of TypeSafe AI's "Jev" typed
decisions, as implemented in the open `open-jev` runtime: one state (text) plus
typed questions go in, one forward pass returns a probability per option.

## Glossary

- **Typed decision.** A question with a fixed answer type: *choice* (one of up
  to 255 options), *yes/no* ("noul" in open-jev), or *score* (2–10 ordered
  levels). The answer is always one of the declared options.
- **Calibrated confidence.** The probability the model gives its answer, such
  that answers given with confidence *p* are right about *p* of the time. It is
  what lets a caller act only when the model is sure.
- **open-jev.** MIT TypeScript library that runs Jev-shaped models through
  `@huggingface/transformers` (browser or Node, CPU/WebGPU/WASM):
  https://github.com/nico-martin/open-jev
- **kev-0.6b / kev-4b.** Apache-2.0 Jev-shaped decision models on Qwen3-0.6B
  and Qwen3-4B, in ONNX (Open Neural Network Exchange) format, the open-jev defaults:
  https://huggingface.co/onnx-community/kev-0.6b-ONNX,
  https://huggingface.co/onnx-community/kev-4b-ONNX

## Evidence

59 labelled tasks: 16 real `TODO.md` items (9 in Italian), 12 real PR titles,
31 synthetic items covering the rarer experts (review, design, brainstorming,
marketing, release notes, status), 7 of those in Italian. Labels are the
owner's to confirm (assumption — labelled by the implementing agent,
2026-09-24). The set is skewed to software engineering (28 of 59, ~47%), which
is also the "always pick software engineering" baseline.

| Approach | Accuracy | Real / synthetic | EN / IT | Confident answers | Warm latency |
|---|---|---|---|---|---|
| **kev-4b, choice over experts** | **83%** | 79% / 87% | 81% / 88% | 97% right on the 58% with confidence ≥ 0.7 | ~0.9 s CPU |
| **kev-0.6b, choice over experts** | **78%** | 93% / 65% | 81% / 69% | 80% right on the 75% with confidence ≥ 0.7 | ~0.12 s CPU |
| kev-0.6b, choice over kinds of work | 71% | 75% / 68% | 74% / 63% | 73% on 56% | ~0.12 s |
| Qwen2.5-Coder 1.5B labels the kind of work ([PR 48](https://github.com/sondalab-ai/spexr-ide/pull/48)) | 63% | 82% / 45% | 63% / 63% | none | ~0.3 s GPU |
| open-jev DeBERTa-v3-large, choice over kinds | 56% | 89% / 26% | 53% / 63% | none above 0.5 | ~0.1 s |
| MiniLM embeddings + example centroids | 49% | 39% / 58% | 58% / 25% | 81% on 27% | ~1 ms |
| Natural language inference (NLI), DeBERTa-v3-xsmall zero-shot | 31% | 14% / 45% | 30% / 31% | none above 0.5 | ~35 ms |

Reading it: the Jev-shaped models win clearly, and only they hold up in
Italian. kev-4b is the most accurate and — more useful — the best calibrated:
when it is sure it is almost always right. kev-0.6b does better on the real
items (mostly software engineering) and is seven times faster, but it is weaker
on the rarer experts and in Italian, and its confidence separates right from
wrong answers poorly. The generative approach that
https://github.com/sondalab-ai/spexr-ide/pull/48 ships scored 11/12 on the 12
tasks its prompt was tuned on and 63% here: tuning on the test set inflated it.
Jev-Omni (12B) and Open-Jev-9B were not evaluated: both need a CUDA GPU.

How often each model is right when it acts on its own, and on what share of the
items it would, at each confidence threshold:

| Confidence ≥ | kev-4b: right / acts on | kev-0.6b: right / acts on |
|---|---|---|
| 0.5 | 85% / 90% | 77% / 95% |
| 0.6 | 91% / 75% | 79% / 88% |
| 0.7 | **97% / 58%** | 80% / 75% |
| 0.8 | 97% / 49% | 85% / 58% |
| 0.9 | 100% / 19% | 87% / 39% |

kev-4b at 0.7 decides six items in ten on its own and is almost always right;
kev-0.6b never reaches that: at any threshold it still gets about one in
eight or more of its own decisions wrong.

### What ships, and two things the first measurement missed

The tables above asked each question once, with expert descriptions written
for the evaluation. Building the service showed that neither holds for the
app, and both matter:

- **Option order.** kev's choice head favours options by position. The same
  three experts listed in another order turned a 0.84 "review" into a 0.78
  "software engineering", and the TODO view lists experts alphabetically. The
  service therefore asks every choice question in three rotations of its
  options and averages the probabilities.
- **Descriptions.** The catalog's descriptions are written for people. With
  them kev-4b routed 75% right and was 89% right when confident; with a
  description naming the kinds of work each expert takes, 83% and 97%. Each
  catalog expert now carries that `routingDescription`, and the service sends
  it.

The harness (below) measures the shipped configuration — the app's service,
the catalog's routing descriptions, three rotations — on the same set:

| Model | Accuracy | EN / IT | Right / decides alone at ≥0.6, 0.7, 0.8 | Latency (loaded) |
|---|---|---|---|---|
| **kev-4b** | **86%** | 86% / 88% | 95% / 71%, **97% / 56%**, 100% / 36% | ~2.4 s (three passes) |
| kev-0.6b | 68% | 67% / 69% | 72% / 90%, 71% / 76%, 74% / 53% | ~0.4 s |

These figures were tuned on the same 59 tasks they
are measured on (97% at 0.7 is 32 of 33), so real items will likely score
somewhat lower; the harness re-measures them as labelled items accumulate.

kev-4b acts alone at 0.7. kev-0.6b is never right often enough to act alone
(79% even at 0.9), so it only ranks the options and the user always confirms.

## Design

### Service

A backend service `SpexrDecisionService` with one method, typed like open-jev:

```ts
decide(state: string, question: ChoiceQuestion | NoulQuestion | ScoreQuestion): Promise<Decision | undefined>
```

`Decision` is the open-jev answer (chosen option or score, confidence, full
distribution). `undefined` means no decision could be made: decisions are
switched off, the model is not available yet, or it failed; callers must treat
that as "leave things as they are". Every caller passes its own confidence
threshold and ignores answers below it.

The service wraps open-jev behind this interface, so the library (0.1.x, young)
can be replaced or vendored without touching callers. The model runs in its own
child process, like the generation worker, one request at a time, with a
per-call timeout: its inference is a synchronous native call of up to a second,
which in the backend process would stall every remote procedure call (RPC) and the wall.

### Model

A preference `spexr.decisions.model`: `kev-4b` (default), `kev-0.6b`, or `off`.

- `kev-4b` by default: its high-confidence answers are dependable, which is
  what lets SPEXR act without asking (see the Evidence). It costs a ~2.5 GB
  download and a couple of seconds per decision.
- `kev-0.6b` as the light option: ~0.4 GB and well under a second, but not
  reliable enough to act alone: it ranks the options and the user confirms.
- Weights come from one of two places, looked up in this order:
  - `resources/models`, vendored by `scripts/fetch-search-model.mjs` like the
    embedding and generation models (development checkouts);
  - `~/.spexr/models`, where the backend downloads them from Hugging Face in
    the background (Slice 4). Releases rely on this: the installer ships no
    weights.

  Only the selected model is fetched; `off` fetches nothing. Once the weights
  are on disk, decisions work with the network off.

### First consumer: TODO routing

"Work on this" asks `decide(item, choice("Which expert should take this task?",
installedExperts, descriptions))`, then:

- **Confident** — the chosen expert's probability is at or above the model's
  threshold (0.7 for kev-4b; kev-0.6b has none, it never acts alone): the item
  goes to that expert without a question, and the notification names the
  expert and its confidence.
- **Unsure** — below the threshold: a picker, "Which expert should take this
  item?", lists the installed experts ordered by probability, each with its
  percentage and description, the model's pick first and selected, plus "Keep
  the agent as it is". Enter confirms the pick; choosing another expert or
  "keep" does what it says; Escape cancels the hand-off and nothing is sent.
- **No decision** — the service returned `undefined` (off, weights missing,
  timed out): the same picker, in the experts' own order and without
  percentages, so the user chooses.
- With no expert installed in the folder, nothing is asked and the agent keeps
  what it runs as.

The thresholds come from the Evidence table and live next to the model
choice, so a model change brings its own. The generative `route` kind, its
prompt and `expert-routing.ts` from
https://github.com/sondalab-ai/spexr-ide/pull/48 are removed.

### Evaluation harness

The dataset and a script (`pnpm --filter @spexr/theia-extensions eval:decisions`)
ship in `packages/theia-extensions/eval/decisions/`. The script routes every
task through the app's own decision service (the built lib, the catalog's
routing descriptions, the same rotations), so it measures what ships. It
prints accuracy per language and per source, how often the model is right
when it acts alone at thresholds 0.5–0.9, and latency. It needs the vendored
weights, so it is not part of CI; it is run whenever the model, the
descriptions or the service change, and its output is pasted into the PR.

## Acceptance criteria

### Slice 1 — Service and model

- **AC-1** `SpexrDecisionService.decide` answers choice, yes/no and score
  questions with open-jev on the configured model, returns `undefined` when off,
  unavailable, failing or over its timeout, and never throws to its caller.
- **AC-2** `spexr.decisions.model` switches between `kev-0.6b`, `kev-4b` and
  `off` without a restart; the next decision uses the new model and its
  threshold.
- **AC-3** The fetch script vendors kev-4b by default and kev-0.6b on request;
  with the weights present the service works with the network off.
- **AC-4** `@huggingface/transformers` moves from 4.2 to 4.3 (open-jev's
  minimum); the embedding model, the generation worker and their tests are
  unchanged by it.

### Slice 2 — TODO routing on the service

- **AC-5** "Work on this" routes through `decide`. At or above the model's
  threshold the item goes to the chosen expert with no question; below it, or
  with no decision, the user picks from the installed experts (ordered by
  probability when there is one, the model's pick preselected), may keep the
  agent as it is, or cancels with Escape and nothing is sent. The `route`
  generation kind and `expert-routing.ts` are removed.
- **AC-6** The routing rule (auto, ask, or no decision; ordering and
  preselection of the picker) is a pure function with unit tests; a live check
  in the running app hands a bug item to software engineering without a
  question, and shows the picker for an item the model is unsure about.

### Slice 3 — Evaluation harness in the repo

- **AC-7** The dataset and the eval script live in the repo, and the script
  reproduces the shipped-configuration table in the Evidence. Labels as
  written by the implementing agent (assumption — accepted when the owner
  approved the spec, 2026-09-24).

### Slice 4 — Download on first run

- **AC-8** When the selected model's weights are in neither models directory,
  the backend downloads them into `~/.spexr/models` about 20 s after the
  frontend first reports the model, without blocking anything. Only the q4
  weights and the config and tokenizer files are fetched.
- **AC-9** A download lands in a `.partial` folder renamed into place when
  complete, so an interrupted or failed download never leaves weights the
  worker would load; the next start begins again from scratch.
- **AC-10** Switching model cancels a download the new model does not need;
  `off` downloads nothing; `SPEXR_MODEL_DOWNLOAD=off` disables downloads (the
  E2E suite sets it). A failed download is retried on the next start or model
  change, never in a loop.
- **AC-11** The status bar shows the download's progress, and a warning if it
  failed; until the weights land, "Work on this" opens the picker without
  percentages.

## Non-goals

- Fine-tuning or training a model. Examples only enter through option
  descriptions.
- GPU-only decision models (Jev-Omni 12B, Open-Jev-9B).
- Replacing the generative model for summaries or commit messages: those produce
  text.
- New consumers beyond TODO routing; they get their own specs, reusing the
  service and the harness.

## Risks

- **A young dependency.** open-jev is at 0.1.2 with a handful of commits. The
  service interface isolates it; if it stalls, the model call it makes is small
  enough to vendor.
- **Small, partly synthetic evidence.** 59 items, 31 synthetic, labelled by the
  implementing agent. The owner confirms the labels before AC-7; the harness is
  there so the numbers are re-measured as real items accumulate.
- **First-run download.** Releases ship no weights; kev-4b (~2.5 GB) is
  downloaded in the background on first run (Slice 4), which on a slow or
  metered connection is a large, silent transfer. Until it lands, every TODO
  item opens the picker. The search models are not covered by this download
  yet: a release still ships without them.
- **Download size.** The default, kev-4b, is ~2.5 GB and loads from disk in
  about 9–11 s (kev-0.6b: about 2 s), measured on the owner's machine; it is
  loaded once, on the first decision. Until its weights are present, decisions return
  `undefined` and routing falls back to the picker, so nothing blocks on it.
- **Asking too often.** Around four items in ten go to the picker with kev-4b,
  and every item with kev-0.6b. That is the price of never auto-picking
  wrongly; the thresholds are re-measured with the harness as real items
  accumulate.
- **Latency.** Three rotations make a kev-4b decision about 2.4 s once
  loaded. Acceptable behind a "Choosing an expert…" progress on an explicit
  click; a consumer that decides on its own, without a click, should measure
  whether fewer rotations keep the accuracy.
