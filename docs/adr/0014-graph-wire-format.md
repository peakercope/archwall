# 14. The graph has a wire format

**Date:** 2026-07-28 · **Status:** Proposed

## Decision

The Project Graph IR gains a serial form: a versioned JSON envelope, plus a content-derived
revision identity.

```ts
interface SerializedGraph {
  archwallGraph: 1;                    // envelope version, independent of irVersion
  irVersion: string;
  host: { name: string; version: string; capabilities: string[] };
  delivery: GraphDelivery;
  modules: Array<{ id; file; kind; packageName?; workspace?; tags?: Record<string, string> }>;
  edges: Array<{ from; to; rawSpecifier; resolvedPath; kind; loc? }>;
}

ProjectGraph.toJSON(): SerializedGraph
ProjectGraph.fromJSON(doc: SerializedGraph): ProjectGraph   // validates envelope + IR major
readonly ProjectGraph.revision: string                       // content hash, computed lazily
```

The CLI gains `archwall graph --out graph.json` and `archwall check --graph-from graph.json`.

## Forces

[ADR-0002](0002-opaque-project-graph.md) made the graph's *representation* private, which is
correct and should stay. But the IR is the project's central contract, and it had no form in which
it could cross a process boundary at all: `ProjectGraph` is a class holding `Map`s,
`HostInfo.capabilities` is a `Set`, and `ModuleNode.tags` is a `ReadonlyMap`.

Four separate future capabilities were blocked by the same missing piece:

1. **Cross-run and CI caching** — a graph cannot be persisted between runs.
2. **Out-of-process analysis** — a slow bundler build cannot feed a fast standalone check, and
   there is no way to inspect what a producer actually saw.
3. **Third-party and non-JS producers** — a Bazel-, Nx-, or Go-side producer emitting JSON is the
   cheapest possible ecosystem expansion, and is currently impossible.
4. **Incremental validation** — needs a persistable graph plus a revision to key a cache on.

Adding a serial form after the IR is frozen at 1.0 makes it either a major version or a permanent
second-class citizen.

## Alternatives considered

- **A binary format.** Premature. JSON is diffable, inspectable, and language-neutral, which is the
  entire point of having a producer-facing contract. A binary encoding can be added later as an
  alternative representation without changing the model.
- **Defer to post-1.0.** Rejected: the envelope is part of the IR contract, and the whole reason
  the IR is being frozen is so that adapters and producers can be written against it.
- **Expose the internal stores instead.** Rejected outright — that is exactly what ADR-0002
  forbids. `toJSON`/`fromJSON` is a *projection*, chosen and versioned by the IR, not a window onto
  the representation.
- **Derive the revision from the host's own build id.** Rejected: not every host has one, and two
  hosts producing the same graph must produce the same revision, or the identity is useless for
  cross-host caching.

## Consequences

- A second representation to keep in sync with the in-memory one, mitigated by a round-trip
  property test: `fromJSON(toJSON(g))` must yield a byte-identical `AnalysisResult`.
- `revision` costs one hash pass over modules and edges, computed lazily so runs that never ask do
  not pay.
- `archwallGraph` is versioned independently of `irVersion`, so the envelope can gain fields
  without an IR major and vice versa.
- The conformance suite gains an artifact format: an adapter author can dump a graph and diff it.
