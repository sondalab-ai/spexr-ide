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
network call and in well under a second: which expert should take a TODO item;
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
  and Qwen3-4B, ONNX, the open-jev defaults:
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
| NLI DeBERTa-v3-xsmall zero-shot | 31% | 14% / 45% | 30% / 31% | none above 0.5 | ~35 ms |

Reading it: the Jev-shaped models win clearly, and only they hold up in
Italian. kev-4b is the most accurate and — more useful — the best calibrated:
when it is sure it is almost always right. kev-0.6b does better on the real
items (mostly software engineering) and is seven times faster, but it is weaker
on the rarer experts and in Italian, and its confidence separates right from
wrong answers poorly. The generative approach that
https://github.com/sondalab-ai/spexr-ide/pull/48 ships scored 11/12 on the 12
tasks its prompt was tuned on and 63% here: tuning on the test set inflated it.
Jev-Omni (12B) and Open-Jev-9B were not evaluated: both need a CUDA GPU.

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
can be replaced or vendored without touching callers. It runs in the backend
process pool like the existing embedding model, one request at a time, with a
per-call timeout.

### Model

A preference `spexr.decisions.model`: `kev-0.6b` (default), `kev-4b`, or `off`.

- `kev-0.6b` by default: 0.12 s per decision and ~0.4 GB, fast enough to run on
  every click.
- `kev-4b` as the accurate option for users who accept a ~2.3 GB download and
  about a second per decision; its calibration makes its high-confidence
  answers dependable.
- Weights are fetched into `resources/models` by
  `scripts/fetch-search-model.mjs`, like the embedding and generation models,
  so a packaged app decides offline. `kev-4b` is fetched only when selected.

### First consumer: TODO routing

"Work on this" asks `decide(item, choice("Which expert should take this task?",
installedExperts, descriptions))`. At or above the threshold (0.5 for kev-0.6b,
0.7 for kev-4b) the agent starts as the chosen expert; otherwise it keeps what
it runs as. The generative `route` kind, its prompt and `expert-routing.ts`
from https://github.com/sondalab-ai/spexr-ide/pull/48 are removed.

### Evaluation harness

The dataset and a script (`pnpm --filter @spexr/theia-extensions eval:decisions`)
ship in `packages/theia-extensions/eval/decisions/`. It prints accuracy, per
language and per source, calibration at 0.5/0.7, and latency for the configured
models. It downloads models, so it is not part of CI; it is run whenever the
model, the prompts or the options change, and its output is pasted into the PR.

## Acceptance criteria

### Slice 1 — Service and model

- **AC-1** `SpexrDecisionService.decide` answers choice, yes/no and score
  questions with open-jev on the configured model, returns `undefined` when off,
  unavailable, failing or over its timeout, and never throws to its caller.
- **AC-2** `spexr.decisions.model` switches between `kev-0.6b`, `kev-4b` and
  `off` without a restart; the next decision uses the new model.
- **AC-3** The fetch script vendors kev-0.6b by default and kev-4b on request;
  with the weights present the service works with the network off.
- **AC-4** `@huggingface/transformers` moves from 4.2 to 4.3 (open-jev's
  minimum); the embedding model, the generation worker and their tests are
  unchanged by it.

### Slice 2 — TODO routing on the service

- **AC-5** "Work on this" routes through `decide` with the per-model threshold;
  below it the agent keeps what it runs as. The `route` generation kind and
  `expert-routing.ts` are removed.
- **AC-6** Unit tests cover the threshold rule and the `undefined` path with a
  fake service; a live check in the running app routes a bug item to software
  engineering and a launch-copy item to marketing.

### Slice 3 — Evaluation harness in the repo

- **AC-7** The dataset (with owner-confirmed labels) and the eval script live in
  the repo, and the script reproduces the Evidence table for the configured
  models.

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
- **Weak calibration on the default model.** kev-0.6b's confidence barely
  separates right from wrong answers. Its threshold therefore only filters the
  clearly unsure cases; kev-4b is the option when a wrong pick is costly.
- **Download size.** kev-4b is ~2.3 GB; it is opt-in and fetched only when
  chosen.
