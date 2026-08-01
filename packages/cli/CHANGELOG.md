# @archwall/cli

## 1.0.0

### Patch Changes

- Updated dependencies [b56068e]
  - @archwall/integration-kit@1.0.0
  - @archwall/core@1.0.0

## 0.2.1

### Patch Changes

- c512a8a: Fix unusable published packages. `0.1.0` and `0.2.0` should not be installed.

  Both earlier releases went to npm with manifests that were never rewritten for publishing:

  - `exports` still pointed at `./src/*.ts`, which no tarball contains — `files` is `["dist"]`. Any
    import of any package threw `ERR_MODULE_NOT_FOUND`.
  - Internal dependencies were published as `"@archwall/core": "workspace:^"`, so installing anything
    with an internal dependency failed with `EUNSUPPORTEDPROTOCOL`.

  Both fields come from Yarn features — `publishConfig.exports` and the `workspace:` protocol — that
  Yarn substitutes when it packs. Releases ran through `changeset publish`, which shells out to
  `npm publish`; npm treats `publishConfig` as npm config, warns `Unknown publishConfig config
"exports"`, and drops it. The pack smoke test never caught it because it packs with Yarn, so it was
  checking a tarball no release ever uploaded.

  Releases now pack with Yarn and upload the finished tarball with `npm publish`, which keeps the
  correct manifest and keeps OIDC trusted publishing (Yarn's own publisher has no token exchange).
  `verify:pack` gained two guards: no `workspace:` range in a publishable manifest, and every
  advertised entrypoint must exist in the tarball — including for ESM-only packages, which the CJS
  load check skips.

  `@archwall/test-utils` is published for the first time in this release.

- Updated dependencies [c512a8a]
  - @archwall/integration-kit@0.2.1
  - @archwall/core@0.2.1

## 0.2.0

### Minor Changes

- 1321ebb: Contract corrections. These are the changes that are cheap now and a
  major version later, so they are made together while the packages are still 0.x.

  **Type-only edges are a fact, not a producer's private decision.** `Edge` gains an open
  `attributes` bag, with `typeOnly` as its first well-known member and a `type-only-edges`
  capability gating it. The CLI previously _deleted_ type-only edges during its scan, which made
  it silently disagree with every bundler adapter about what the graph contained, with no way for
  a user to get them back. It now labels them, and whether an erased import counts as a dependency
  is answered by configuration — a new `dropTypeOnlyEdges()` transform — rather than by whichever
  producer happened to build the graph. `kind` keeps answering exactly one question, so a
  re-export that is also type-only is finally expressible.

  Edges that dedupe onto one another now _merge_ their attributes by intersection rather than
  first-wins. `import type { A } from "./x"` beside `import { b } from "./x"` is one dependency
  and it is not type-only; union semantics there would let a "type-only may cross this boundary"
  rule wave through a real violation.

  **The CLI no longer passes green over files it never read.** It lexes JavaScript and TypeScript
  only, so `.vue`, `.svelte`, and `.astro` files inside the project boundary produced no module, no
  edge, and no warning — a green CI run over a codebase half of which was invisible. A new
  `unscannable-files` diagnostic names the count, the extensions, and a sample of paths, gated by
  `failOnDiagnostics.unscannableFiles` (default off, so nobody's CI breaks on upgrade).
  **Breaking:** `buildGraphFromFilesystem` now returns `{ graph, diagnostics }` rather than a
  `ProjectGraph`.

  **Rules receive a `GraphView`, not a `GraphQuery`.** The read surface a rule may rely on is now
  an interface; `GraphQuery` is its sole implementation and has moved to `@archwall/core/internal`.
  Naming the class froze the implementation into the public contract, made test doubles impossible,
  and would have turned any future interned or columnar store into a breaking change.
  **Breaking:** import `GraphQuery` from `@archwall/core/internal` if you were constructing one —
  or, if you were doing so to test a rule, use `@archwall/test-utils` instead.

  **`@archwall/test-utils` is now published.** There is no rule ecosystem without a supported way
  to test a rule, and `ProjectGraph` is opaque by design, so building a fixture graph by hand is
  not something a third party could otherwise do. `runRule` drives the real engine, so scoping,
  option validation, and message rendering behave in a test exactly as they do in a build.

  **Reserved seams, declared before they are honoured.** `analyze()` takes an optional third
  parameter (`signal` is honoured between rules; `previous` is accepted and ignored, reserving the
  name for incremental reuse). `ProjectGraph` carries a `revision`. `AnalysisResult` always carries
  a `suppressed` list, `UserConfig` accepts `baseline`, and a `baseline-stale` diagnostic gate
  exists — all inert for now. Each of these lives on a type that is about to be frozen, and adding
  them after the freeze would cost a major apiece.

### Patch Changes

- Updated dependencies [1321ebb]
  - @archwall/integration-kit@0.2.0
  - @archwall/core@0.2.0

## 0.1.0

### Minor Changes

- 4415522: Initial release.

### Patch Changes

- Updated dependencies [4415522]
  - @archwall/core@0.1.0
  - @archwall/integration-kit@0.1.0
