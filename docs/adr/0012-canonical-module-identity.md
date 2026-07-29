# 12. Canonical module identity

**Date:** 2026-07-28 · **Status:** Accepted

## Decision

`ModuleId` has a canonical grammar defined by the IR, not by whichever host produced the graph:

```
file:<repo-relative-posix-path>     source | workspace | excluded
pkg:<name>[/<subpath>]              package        (pkg:react, pkg:@scope/pkg/sub)
builtin:<specifier>                 builtin        (builtin:node:fs, builtin:bun:sqlite)
virtual:<host>:<opaque>             virtual        (virtual:vite:preload-helper)
unresolved:<raw-specifier>          unresolved
```

`ModuleNode.file` keeps the absolute path — rules and reporters need it. The **id** is
machine-independent.

Canonicalisation happens in `GraphBuilder.build()`, the one choke point every producer already
passes through. Adapters keep reporting host facts; the shared layer decides identity — the same
division [ADR-0010](0010-module-kind-not-external-boolean.md) established for `kind`.

`FINGERPRINT_SCHEME` moves to `aw3`.

## Forces

`ModuleId` was documented as `string` and was, in practice, whatever the host called a module.
Rollup used its own id; Rspack and webpack used the absolute resource path but `external "react"`
for externals; esbuild used a resolved path for inputs and the **bare specifier** for
`external: true`; the CLI resolved everything, so `react` became
`…/node_modules/react/index.js`.

`fingerprintOf` hashed those raw ids. So one violation on `import "react"` fingerprinted
differently under the CLI than under esbuild — falsifying the promise that "the same architecture
problem under two bundlers yields the same fingerprint", and making a correct baseline file
impossible to build.

The parity and conformance suites did not catch it because both carried a normalisation helper
(`normalize()` in the e2e parity test, `rel()` in `conformance.ts`) that collapsed externals to
their package name *before* comparing. Two independent copies of the same normalisation, in test
code, was the signal that the normalisation belonged in the IR.

### A package is one node

`pkg:` carries the package **name only**, with no subpath, so every module of a dependency
collapses to a single node.

This is forced rather than chosen. An esbuild `external: true` import is never resolved, so the
subpath is genuinely unknowable there, while the CLI resolves `react` to
`…/node_modules/react/index.js`. Any scheme that preserved file granularity inside a package would
therefore diverge across hosts — which is the defect this record exists to fix.

It also happens to be the right model. For an architecture linter a dependency is a unit: the
finding is "domain imports react", never "domain imports react's CJS entry". No built-in rule reads
per-file identity inside a package — `forbidden-dependencies` and the `layered` purity rules match
on `packageName` and `moduleKind`, `no-deep-imports` matches on the raw specifier, and `no-cycles`
skips foreign components entirely. `ModuleNode.packageName` still carries the name, so every rule
keeps working unchanged.

Two imports of the same package with different specifiers (`react` and `react/jsx-runtime`) remain
two distinct edges, because edge identity includes the raw specifier.

Builtins normalise the same way: a bare `fs` and a prefixed `node:fs` are one module,
`builtin:node:fs`.

## Alternatives considered

- **Keep host ids; normalise only inside `fingerprintOf`.** Cheaper, and fixes the fingerprint. But
  it leaves ids incomparable everywhere else — conformance snapshots, the JSON reporter, the future
  graph wire format, the future baseline. The problem would have been hidden in one function rather
  than solved.
- **Add a second `canonicalId` field, keep `id` as the host's.** Non-breaking for output, but it
  creates two identity vocabularies permanently, and every consumer — including third-party rules
  and reporters — has to know which one to use for which purpose. Wrong answers become the default
  for anyone who picks the familiar-looking one.
- **Require every adapter to resolve externals to files.** Impossible: an esbuild external genuinely
  has no file, and forcing resolution would make the CLI and the bundlers disagree about imports
  that cannot be resolved at all.
- **Content-hash identity.** Wrong axis. Architecture is about a module's position in the tree, not
  about what it contains; a file whose contents change is the same module.

## Consequences

- Ids are no longer directly pasteable into an editor. Mitigated: `ModuleNode.file` carries the
  absolute path, and every reporter already renders repo-relative paths.
- Every existing fingerprint changes. The `FINGERPRINT_SCHEME` prefix exists precisely so a stale
  baseline errors rather than silently mismatching every entry; it moves to `aw3`.
- `normalize()` and `rel()` are **deleted** from the parity and conformance suites. Parity holding
  on raw ids is the acceptance criterion for the change — if it holds, the abstraction is real.
- `GraphBuilder` needs `repoRoot`, which `createArchWallRun` supplies from the resolved config.
- Fixture graphs (`@archwall/test-utils`) bypass `GraphBuilder` and keep using bare ids; they gain
  an opt-in for exercising the real id shape.
