# probe-engine

Answers probes from cached evidence. A probe resolves once, keeps the
evidence behind its answer, and re-runs only when what it read changed.

```sh
pnpm test probe
pnpm sl-audit
```

The p95 of a cached resolve stays under 2 ms (`P95_BUDGET_MS`); the audit
fails the build above it.
