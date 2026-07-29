# 20. Reporters are batch-only

**Date:** 2026-07-29 · **Status:** Accepted

## Decision

`Reporter` has two hooks, both batch: `onRunStart(info)` and `onRunEnd(result)`. There is no
per-violation hook. `Reporter.onViolation` is **removed**.

A reporter that wants to react to individual findings iterates `result.violations` in
`onRunEnd`, which is where the list is complete, ordered, and final.

## Forces

`onViolation` was documented as *"Streaming, called as each violation is found."* It was not.
It fired in `run.check` **after** `analyze()` had already resolved, iterating the finished,
sorted array — a second batch pass wearing a streaming name.

The evidence was in-tree and load-bearing: `consoleReporter` carried a `seen: Set<Violation>`
whose only job was to deduplicate between the two channels, plus an `onRunStart` that existed
to clear it. A reporter had to understand a distinction that did not exist in order to produce
correct output.

Three facts make real streaming the wrong thing to build rather than merely the thing we had
not built yet:

1. **Ordering.** `analyze()` sorts violations with `compareViolations` before returning, and
   that determinism is a hard requirement — baselines (ADR-0016), CI diffing, and snapshot
   tests all need two runs to be byte-identical. Streaming means rule-execution order, which
   varies with bucket iteration. A streaming reporter and a batch one would print the same run
   differently.
2. **Synchrony.** `visit(item, ctx)` is synchronous by design (ADR-0003) — the traversal cannot
   await. So a streaming hook could never be `Promise`-returning, while `onRunEnd` is awaited
   precisely so a reporter can write a file or flush a socket. Two hooks with different
   contracts for the same job.
3. **Discarded findings.** A crashed rule's partial violations are dropped before the result is
   built. Anything streamed as it was reported would already have been emitted, so a streaming
   reporter would show findings the batch channel says do not exist.

## Alternatives considered

- **Wire it for real** — pass an `onViolation` callback into `analyze()` and fire it from
  `ctx.report`. Rejected on all three counts above. It would also put a reporter-shaped concern
  into the pure engine, which core deliberately has none of.
- **Keep it as a batch alias, fix the doc comment.** Rejected: two ways to receive the same
  list, one of which needs a dedup set to use correctly, is worse than one way. The comment was
  not the defect.
- **Rename it `onViolations(all)`.** Rejected: that is `onRunEnd` with less context.

## Consequences

- `consoleReporter` loses `seen`, `onRunStart`, and its second `repoRoot` source; it is now
  stateless and reads `result.repoRoot`. That is what makes it safe for the bundler adapters to
  memoize one run object across every watch rebuild.
- Breaking for any third-party reporter that implemented `onViolation`. Pre-1.0 and there are
  none; the migration is to move the body into `onRunEnd` and loop.
- If a genuine consumer for incremental output appears — a long-running watch server, a
  progress UI — adding an optional hook back is **additive** and non-breaking. Deciding against
  it now costs nothing later; shipping the wrong contract at 1.0 costs it permanently.
