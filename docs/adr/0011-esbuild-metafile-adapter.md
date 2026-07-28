# 11. The esbuild adapter reads the metafile

**Date:** 2026-07-28 · **Status:** Accepted

## Decision

`@archwall/esbuild` extracts the graph once, at `onEnd`, from the build's **metafile**. It
claims `raw-specifiers` unconditionally, claims `complete-graph` only when `bundle: true`,
and claims neither `import-locations` nor `reexport-edges`.

## Forces

Every other adapter observes the build as it happens. Rollup has `resolveId` and
`getModuleInfo`; webpack and Rspack have `finishModules` and a `moduleGraph`. esbuild has
neither: its plugin API covers resolution and loading of individual files, and there is no
hook that hands over the linked graph.

What it does have is the metafile — a complete record, written after the fact, of every
input and every import between them. So this adapter is not a walk over a live structure; it
is a read of a finished document. `metafile.inputs` is the entire extraction surface, which
makes each capability a straightforward question about what that document contains.

## Consequences

### `raw-specifiers` is unconditional, unlike Rollup's

[ADR 0008](0008-rollup-adapter-extraction.md) established that this capability must be
claimed from *evidence*: Rollup's `resolveId` is first-wins, so an adapter ordered after the
resolvers never sees what the author wrote, and claiming it anyway makes every
specifier-matching rule report a clean run instead of an unavailable one.

That hazard is a property of the *hook*, not of the capability. The metafile records the
pre-resolution specifier for every import — as `original` when the import resolved elsewhere,
and as `path` itself when it did not — and no plugin ordering can remove it. So here the
unconditional claim *is* the evidence-based one. The doctrine is "claim what you can
actually deliver", not "claim defensively"; a host that always has something should say so.

The practical difference is visible to users: `@archwall/rollup` must be placed before the
resolvers to enable specifier rules, and `@archwall/esbuild` can go anywhere.

### `complete-graph` is gated on `bundle: true`

The same doctrine pointed the other way. Without bundling, esbuild never follows an import —
verified against 0.28, a non-bundling build of a five-module fixture reports one input with
zero imports. A whole-graph rule run against that would report a clean project rather than an
unanalysed one, which is precisely the silent failure the capability system exists to
prevent. So the claim is conditional on the option that makes it true.

### Two capabilities are declined, here and in Rollup

The metafile has no line or column anywhere, so `import-locations` is unavailable. It records
`export … from` as a plain `import-statement`, so `reexport-edges` is too.

**Rollup could support both** — `moduleParsed` exposes `info.ast`, from which import
locations and the re-export/import distinction are both derivable — and deliberately does
not. Walking every module's AST is a per-module cost the adapter otherwise avoids entirely,
and the conformance harness's `coarse` edge-kind mode exists specifically so that a host
honestly reporting `static` for a re-export is not failed for it. Under-claiming already
produces the correct degradation: the affected rules skip loudly.

This is recorded so it reads as a decision rather than an oversight. It is reversible the day
someone wants location-anchored violations under Rollup badly enough to pay for the walk.

### Known cost, not changed: Rollup resolves twice

Capturing raw specifiers under Rollup means calling `this.resolve(source, importer,
{ skipSelf: true })` for every import, which runs the resolver chain a second time. It is the
only way Rollup exposes what the author wrote, so it stays — but it is a real cost and better
written down than rediscovered.

### Six producers, all compared

Adding esbuild was also the occasion to fix a gap ADR 0008 left open: `@archwall/rollup` was
never a producer in the cross-producer suites, so it was checked against its own fixture
expectations and never IR-for-IR against another host. Both suites in `@archwall/cli` now run
all six — Vite, Rollup, esbuild, Rspack, webpack, CLI.

Doing that immediately paid for itself. Rollup and esbuild are the first producers to report
an unresolved external as a **bare specifier** rather than a resolved `node_modules` path,
and the parity suite's own path-normalizer had no `isAbsolute` guard — it resolved `react`
against `process.cwd()` and compared `../../../../../react`. Four producers had hidden the
defect by all happening to resolve externals the same way.
