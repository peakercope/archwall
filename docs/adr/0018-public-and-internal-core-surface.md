# 18. Public and internal core surface

**Date:** 2026-07-28 · **Status:** Proposed

## Decision

`@archwall/core` has two entry points.

`@archwall/core` — **public, semver-major to break.** The graph IR and its read surface
(`ProjectGraph`, `GraphQuery`, `ModuleNode`, `Edge`, kinds, capabilities); every contract and its
`define*` helper; configuration types plus `defineConfig`/`resolveConfig`; violations and
diagnostics; `analyze`; the built-in reporters; `pathClassifier`; `matchesPattern`.

`@archwall/core/internal` — **no stability guarantee, may change in any release.** `GraphIndex`,
`GraphDraft`, `filterKey`, `prepareGraph`, `applyProjectBoundary`, `BoundaryConfig`,
`PrepareConfig`, `PrepareResult`, `GraphComputationCache`, `hashParts`, `stableHash`,
`sourceRelative`, `toRelative`. Tests import from here.

An API-surface snapshot test fails on any unreviewed change to the public entry point.

Separately, the `archwall` umbrella re-exports **everything** public from core, so it is genuinely
"the only package most users import".

## Forces

`packages/core/src/index.ts` exported roughly 110 symbols with no public/internal distinction.
Several existed only because a test needed them — `prepareGraph`, `applyProjectBoundary`,
`GraphIndex`, `filterKey` are engine internals with no user-facing purpose.

The README already promised "config shape, rule/preset/reporter contracts, umbrella exports, the
graph IR" as semver-major-to-break. It said nothing about the other sixty. In the absence of a
statement, users import what they can see, and every one of those symbols becomes a compatibility
obligation nobody chose to take on. Freezing at 1.0 without drawing the line means the line gets
drawn by whichever internal a popular downstream package happened to reach for.

The umbrella had the mirror problem: it re-exported a hand-picked subset of core's types, so any
non-trivial user hit "not exported from `archwall`" and added `@archwall/core` alongside it —
defeating the package's stated purpose and putting two import paths in one config file.

## Alternatives considered

- **`@internal` JSDoc tags only.** Not enforceable. TypeScript will still complete and import them,
  and nothing fails when someone does.
- **Freeze everything.** Honest, and fatal: it forecloses the interned/columnar store that
  [ADR-0002](0002-opaque-project-graph.md) exists to keep reachable, and freezes
  `sourceRelative`'s edge-case behaviour forever.
- **Freeze nothing until 2.0.** Rejected: adapter and rule authors need something to build on, and
  "everything might change" is indistinguishable from having no contract.
- **A separate `@archwall/core-internal` package.** More ceremony than a subpath export, and it
  would tempt people to depend on it directly rather than treating it as a repo-internal detail.

## Consequences

- Import churn across the test suite in one pass, then never again.
- Refactoring freedom for the internals for the life of 1.x, which is the point.
- The snapshot test makes "did this PR change the public API?" a review question with an automatic
  answer rather than a thing someone has to notice.
- Anyone reaching into `/internal` has opted in explicitly and cannot claim surprise.
