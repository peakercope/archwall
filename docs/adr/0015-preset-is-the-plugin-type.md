# 15. `Preset` is the plugin type

**Date:** 2026-07-28 · **Status:** Accepted

## Decision

There is no separate `Plugin` type and no plugin lifecycle. `Preset` is the one unit a third party
ships, and it widens as needed:

```ts
interface Preset {
  name: string;
  meta?: PresetMeta;        // version, description, docsUrl — added now, while nobody is broken
  classifiers: Classifier[];
  rules: AnyConfiguredRule[];
  transforms?: GraphTransform[];
  reporters?: Reporter[];
}
```

Lifecycle hooks (`onConfigResolved`, `onRunStart`, …) are **not** added speculatively. They are
added when a real consumer needs one, as optional fields on this interface.

## Forces

The obvious alternative — a `Plugin` type above `Preset`, carrying hooks and a registry — costs
more than it looks:

- Everyone has to learn which of the two they need.
- Every downstream API (`UserConfig`, the loader, `resolveConfig`) has to accept both.
- Two near-identical bundles diverge in capability over time, and the docs have to explain why.

Widening the one bundle that already exists costs a few optional fields and no new vocabulary.

`meta` in particular must land **now**. `Preset` is promised as stable, and adding a required or
even an optional field to a stable interface is a breaking change for anyone who wrote
`satisfies Preset`. Today that is nobody. After the first third-party preset ships, it is
everybody.

## Alternatives considered

- **A `Plugin` type with lifecycle hooks and a registry.** Rejected as above — a second vocabulary
  bought nothing that optional fields on `Preset` cannot buy later.
- **Hooks now, pre-emptively.** Rejected: no consumer exists, so the hook set would be guessed. A
  guessed lifecycle is worse than no lifecycle, because it must then be supported.
- **Keep `Preset` closed and route extension through config only.** Rejected: it forecloses
  transforms and reporters shipped as one installable unit, which is the ecosystem's whole point.

## Consequences

- One vocabulary: "an ArchWall plugin is a preset".
- `PresetMeta` is optional and open, so a preset can carry `version`, `description`, and `docsUrl`
  for discovery and diagnostics without every author being forced to supply them.
- A future lifecycle is an additive decision, recorded rather than assumed. If it lands, it lands
  as optional methods on `Preset`.
- Presets remain plain data returned by a function, so composition is ordinary JavaScript — no
  `preset.extend()` API is needed or provided.
