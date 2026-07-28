# 1. Host capabilities and graph delivery modes

**Date:** 2026-07-26 · **Status:** Accepted (recorded retroactively)

## Decision

A host declares a set of `Capability` strings. A rule declares `requiredCapabilities`. A rule
whose requirements the host cannot meet is **skipped with a diagnostic**, never run against
data that cannot support it. `GraphDelivery` is `complete` or `progressive`; progressive
delivery removes `complete-graph` regardless of what the host claims.

## Forces

The tool's most dangerous property is that its failure mode is **silence**. Every rule
ignores what it cannot see, so a rule running against a graph that lacks the facts it needs
does not fail — it reports nothing, which is indistinguishable from a clean codebase.

The motivating case: under Vite dev the module graph carries no import specifiers, so
`Edge.rawSpecifier` falls back to the resolved id. Every specifier-matching pattern then
misses, and `no-deep-imports` reports a clean run rather than an unavailable one.

## Consequences

- Capabilities are an **open union**. New graph facts arrive additively, and a transform may
  *contribute* a capability — which is why capabilities belong to the graph rather than to
  the adapter.
- Under-claiming is the correct failure mode: it produces a loud skip. Over-claiming produces
  silent nonsense. See [ADR 0008](0008-rollup-adapter-extraction.md) for a case where the
  distinction was only caught by running an adapter under a host of its own.
- The engine also emits `no-modules-classified` and `empty-project` for the same reason:
  they are the difference between "your architecture is clean" and "ArchWall never looked at
  your code".
