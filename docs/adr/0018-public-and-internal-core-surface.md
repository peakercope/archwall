# 18. Public and internal core surface

**Date:** 2026-07-28 · **Status:** Accepted (implemented 2026-07-31)

## Decision

`@archwall/core` has two entry points.

`@archwall/core` — **public, semver-major to break.** The graph IR and its read surface
(`ProjectGraph`, `GraphQuery`, `ModuleNode`, `Edge`, kinds, capabilities); every contract and its
`define*` helper; configuration types plus `defineConfig`/`resolveConfig`; violations and
diagnostics; `analyze`; the built-in reporters; `pathClassifier`; `matchesPattern`.

`@archwall/core/internal` — **no stability guarantee, may change in any release.** `GraphIndex`,
`GraphDraft`, `filterKey`, `prepareGraph`, `applyProjectBoundary`, `BoundaryConfig`,
`PrepareConfig`, `PrepareResult`, `GraphComputationCache`, `hashParts`, `stableHash`,
`sourceRelative`, `toRelative`.

**Tests and first-party packages import from here.** Not tests alone: `@archwall/cli` needs
`sourceRelative` and `@archwall/integration-kit` needs `toRelative`, both in shipped production
code. Every ArchWall package is released in lockstep from this repository, so there is no version
skew for the guarantee to protect them from — the guarantee exists for third parties, and it stays
exactly as strong for them either way. The alternatives were worse in both directions: promoting
the two would freeze `sourceRelative`'s documented edge case (an already-relative path treated as
root-relative) forever, and duplicating them into the two consumers would create two copies of
path logic that must not drift.

**The public entry point holds under 60 values.** It lands at 49 (from 55), with 71 types. Types
are enumerated and frozen but not capped: a rule cannot be written without `Violation`, `Edge` and
`RuleContext`, so squeezing the type surface to hit a combined figure would delete things users
need in order to hit a number that was never the point. The obligation a type creates is real,
which is why they are listed; it is not the obligation a value creates, which is why they are not
capped.

An API-surface test (`packages/core/test/public-surface.test.ts`) fails on any unreviewed change
to the public entry point. It is a frozen literal list, deliberately not a regenerable snapshot —
see Alternatives.

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
- **A regenerable snapshot (`toMatchFileSnapshot`) for the surface test.** Rejected: the
  requirement is that an *unreviewed* change fails, and `vitest -u` turns an unreviewed change into
  one keystroke landing as `.snap` churn that reviewers skim past. A frozen array in the test file
  cannot be regenerated, so the change has to appear in the diff as an edit to source. It also
  matches a repository with no `.snap` files and a hand-rolled throwing-assert idiom already
  established by `assertGraphsMatch`.
- **Enumerating types from the built `.d.ts`.** Rejected: it makes the test require a build, and it
  answers the question against rolldown's declaration roll-up rather than against the barrel a
  reviewer actually reads. The test parses `src/index.ts` with the TypeScript compiler API instead,
  which needs no build and no type checker.

## Consequences

- Import churn across the test suite in one pass, then never again.
- Refactoring freedom for the internals for the life of 1.x, which is the point.
- The snapshot test makes "did this PR change the public API?" a review question with an automatic
  answer rather than a thing someone has to notice.
- Anyone reaching into `/internal` has opted in explicitly and cannot claim surprise.
- Types are erased, so the test needs two derivations of one barrel — the runtime namespace for
  values, a syntactic parse for types. Comparing them against each other is what catches a class
  re-exported as `export type`, which is invisible to either derivation alone. That bug was
  present: the umbrella re-exported `ProjectGraph` and `GraphQuery` — both classes — as types, so
  `new ProjectGraph(...)` failed for anyone importing from `archwall`.
- The subpath costs one hand-written `typesVersions` entry in `packages/core/package.json`. node10
  ignores `exports` entirely and cannot resolve a subpath, which attw reports as a failure under
  the strict profile; `typesVersions` is the one mechanism node10 does consult. Everything else in
  that package's `exports` block is generated by tsdown from the entry list on every build.
- The umbrella becomes `export * from "@archwall/core"`, so completeness is now a property that
  cannot drift rather than a reconciliation someone has to remember.
