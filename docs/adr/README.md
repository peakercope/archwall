# Architecture decision records

Why things are the way they are, and what was tried instead.

This directory exists so that source comments can state **invariants** — what is true now,
and what must stay true — instead of narrating the codebase's own history. Both are worth
keeping; only one of them belongs inline.

Inline history has three problems that show up on a five-year horizon:

- It documents code that no longer exists, so nothing can verify it and it rots invisibly.
- A reader cannot tell a current constraint from a past mistake — both are prose in the same
  comment block, given the same weight.
- It reads as a pre-emptive rebuttal, which is a poor greeting for a contributor who has a
  better idea than the one that was rejected in 2026.

An ADR is dated, supersedable, and skippable. A comment is none of those.

## Format

Each record states the decision, the forces behind it, what was rejected and why, and what
it costs. When a decision is reversed, add a new record and mark the old one superseded —
never edit history into agreement with the present.

## Records

| # | Decision |
|---|---|
| [0001](0001-capabilities-and-delivery.md) | Host capabilities and graph delivery modes |
| [0002](0002-opaque-project-graph.md) | `ProjectGraph` is opaque; transforms mutate |
| [0003](0003-rule-visitor-model.md) | Rules declare interest; the engine owns traversal |
| [0004](0004-violation-locations.md) | Violations carry a list of locations |
| [0005](0005-message-templates.md) | Rules report `messageId` + `data`, not sentences |
| [0006](0006-reporter-output-destinations.md) | Each reporter has its own output destination |
| [0007](0007-config-errors-as-diagnostics.md) | Configuration errors are diagnostics, not throws |
| [0008](0008-rollup-adapter-extraction.md) | Rollup is its own adapter package |
| [0009](0009-one-project-boundary-pipeline.md) | One pipeline: boundary → transforms → boundary → classify |
| [0010](0010-module-kind-not-external-boolean.md) | Seven module kinds instead of `external: boolean` |
