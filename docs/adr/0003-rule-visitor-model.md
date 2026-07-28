# 3. Rules declare interest; the engine owns traversal

**Date:** 2026-07-28 · **Status:** Accepted

## Decision

A rule declares what it wants to look at via `visits: { edges?, modules? }`, each with an
optional filter derived from the rule's options. The engine resolves each distinct
(scope, filter) pair once and dispatches the resulting slice to every rule that asked for
it. `check(ctx)` remains for rules that genuinely need the whole graph at once.

## Forces

Every rule used to open with `for (const e of ctx.graph.edges())` and do its own filtering.
Three consequences:

1. **Cost was O(rules × graph).** `edges()` with no filter returned `[...edges]` — a full
   copy of the edge list, per call, per rule. At 40 rules and 200k edges that is 8M element
   copies per run, protecting nobody: the array was already immutable.
2. **The engine could not attribute work to rules.** Incremental validation requires knowing
   which rules a changed edge can affect. Nothing in the old model expressed that, so
   incrementality was not merely unimplemented — it was unreachable.
3. **Three built-in rules were the same rule.** `layer-dependencies`, `feature-isolation`,
   and `friend-modules` each hand-rolled: iterate crossing edges, read both tags, apply a
   predicate, format a message. At fifty rules that is fifty copies of the loop.

## Alternatives

**Optimise `edges()` and leave the model alone.** Fixes (1) and nothing else. The copy was
the cheapest of the three problems.

**Make every rule a visitor, with no escape hatch.** Cycle detection and reachability are
global properties, not predicates over one edge. Forcing them through a visitor would mean
each such rule accumulating state across visits and acting in a teardown callback — an
obfuscated `check` with extra steps.

## Consequences

- Rules that share a filter share a traversal. Two rules asking for `crossing: "layer"` see
  the identical `Edge` objects from one materialised slice.
- Isolation is per rule, per slice: the try/catch wraps a rule's whole pass rather than each
  visit, so a throwing rule stops without the engine paying for exception handling per edge.
- Per-rule timings for rules sharing a traversal measure their own iteration, not the shared
  filtering — accurate enough to find a slow rule, not a benchmark.
- `ConfiguredRule` became invariant in its option type, because `visits.filter(options)` and
  `visit(item, ctx)` put `Options` in contravariant position. Hence `AnyConfiguredRule`. This
  is the one real cost, and it is confined to the type layer.
