# 9. One pipeline: boundary → transforms → boundary → classify

**Date:** 2026-07-28 · **Status:** Accepted

## Decision

`prepareGraph` is the only path from a producer's graph to a classified one. There is a
single implementation of the project boundary, and it runs both before and after transforms.

## Forces

There were two implementations and two orderings, selected by
`config.transforms.length === 0`:

- No transforms → a fused boundary+classify pass.
- Transforms → boundary, then transforms, then classify — with **no second boundary**.

So a module contributed by a transform was classified but never boundary-checked. A type-edge
enricher adding `src/foo.test.ts` would leave it `kind: "source"` on one path and `excluded`
on the other. Same config, different answer, chosen by a condition with nothing to do with
semantics.

`relativeToRoot` and the entire boundary loop were duplicated verbatim between the two files,
including their comment blocks — the standard way two implementations of one idea drift.

## Consequences

- The boundary is idempotent (it only ever re-kinds `source` → `excluded`), so running it
  after transforms is safe and covers their contributions.
- The no-transform case still costs a single pass over the modules, which is what the
  allocation budget was about: two passes each rebuilt the whole module map.
- A transform that throws has its draft discarded, so partial writes never reach
  classification.
