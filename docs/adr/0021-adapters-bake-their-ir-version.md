# 21. Adapters bake their IR version at build time

**Date:** 2026-07-29 · **Status:** Accepted

## Decision

The IR version an adapter stamps on the graphs it produces is captured at **its own build
time**, not read from the core it links against at runtime.

`tsdown.shared.ts` declares `define: { __ARCHWALL_IR_VERSION__: <IR_VERSION> }`, reading the
constant out of `packages/core/src/graph/ir.ts`. `@archwall/integration-kit` exposes it as
`BUILT_IR_VERSION`, and `GraphBuilder` stamps it via `ProjectGraph.create({ irVersion })`.
`GraphBuilderOptions.irVersion` lets a third-party adapter supply its own.

In source — this repository's tests, or a consumer resolving core to `src/` — the identifier is
absent and `BUILT_IR_VERSION` falls back to the linked `IR_VERSION`.

## Forces

`assertIrCompatible(graph.irVersion)` exists to detect **adapter/core skew**: an adapter
compiled against IR 1.x loaded beside a core that speaks 2.x. It could not do that.

`GraphBuilder.build()` never set `irVersion`, so `ProjectGraph.create` defaulted it to the
`IR_VERSION` of the core the adapter had linked — which `assertIrCompatible` then compared to
the same constant from the same module. The check could only fire under a duplicated-core
install, never under the skew it documents. It was, in effect, dead code guarding the one
failure mode a versioned IR exists to catch.

The version being compared has to come from somewhere the linked core cannot supply. Build time
is the only such moment.

## Alternatives considered

- **Read the adapter package's own `version` from `package.json`.** Rejected: package version
  and IR version are deliberately independent (`ir.ts:4`), so this compares the wrong two
  numbers and would fire on every ordinary release.
- **A committed generated file** (`ir-version.generated.ts` + a `prebuild` script). Rejected:
  a generated artifact in source control goes stale silently, and keeping it correct becomes a
  review obligation on every IR change.
- **Import `IR_VERSION` into `tsdown.shared.ts`.** Attempted and rejected: tsdown loads its
  config with a native `import`, which cannot resolve the `.js` specifier of a `.ts` source
  file. The config reads the file and matches the declaration instead, throwing with a pointer
  to this ADR if the declaration ever moves — a loud failure at build time rather than a wrong
  constant baked into every published adapter.
- **Defer to the wire format (M4).** Rejected: ADR-0014's envelope solves producer identity for
  *serialized* graphs. In-process adapter/core skew is a different question and is the one the
  existing check already claims to answer.

## Consequences

- The check is reachable, and tested: `packages/integration-kit/test/ir-version.test.ts` builds
  a graph at a skewed major and asserts `IrVersionMismatchError`. That is the first test to
  exercise `assertIrCompatible` at all.
- `ProjectGraphInit.irVersion`'s guidance inverts. It read *"Adapters should leave this alone"*;
  adapters are now exactly who should set it, and the default is the fallback rather than the
  intended path.
- The dev fallback is safe where it is reached: in this repository core and every adapter are
  one working tree by construction, so they cannot be skewed. Verified after `yarn build` —
  rolldown substitutes the literal and constant-folds the guard, so `__ARCHWALL_IR_VERSION__`
  does not survive into `dist/`.
- `define` is set for every package, not just `integration-kit`. Harmless — nothing else
  references the identifier — and it means a future adapter package gets the same treatment
  without touching build config.
