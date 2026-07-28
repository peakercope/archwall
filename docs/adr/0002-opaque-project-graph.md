# 2. `ProjectGraph` is opaque; transforms mutate

**Date:** 2026-07-28 · **Status:** Accepted

## Decision

`ProjectGraph` is a class with private backing stores and a small, final read API. No
accessor hands out a `Map` or an `Edge[]` that a caller could depend on the shape of.
`GraphTransform` writes through a `GraphMutation` interface instead of taking a graph and
returning a new one.

## Forces

The IR is promised as stable. Whatever a third party can observe about the graph's
*representation* becomes part of that promise, whether or not it was meant to.

Before this decision the graph was a plain object: `{ modules: ReadonlyMap<…>, edges:
readonly Edge[] }`. `GraphBuilder.build()` returned one, `@archwall/test-utils` constructed
one as a literal, and every transform received and rebuilt one. A comment on `GraphQuery`
claimed that keeping its own reference private preserved the freedom to change the
representation later. That was not true: the representation was already visible in four
places and reachable by anyone.

At 50k modules the representation is not an academic concern — it is 50k `Map` instances for
tags plus ~200k `Edge` objects, and an interned or columnar store is the obvious next move.
That move has to remain possible without an IR major.

## Alternatives

**Keep the plain object and document the representation as frozen.** Honest, and cheaper
today. Rejected because it forecloses the one optimisation most likely to matter at the
scale the project is aiming at, in exchange for nothing but not doing the work now.

**Keep graph-in/graph-out transforms but freeze the objects.** Does not help: a transform
that rebuilds a graph must know its fields, so adding a field to the IR silently breaks
every transform that spreads the old shape. The mutation API removes that whole class of
bug as a side effect.

## Consequences

- A transform can no longer construct a graph from scratch. It adds, patches, and removes.
  This is a real restriction, and the right one: a pass that wants to replace the graph
  wholesale is a *producer*, not a transform.
- `GraphDraft` makes writes copy-on-write, so a transform that touches nothing costs
  nothing, and one that throws leaves no partial writes behind.
- Tests and fixtures construct graphs through `ProjectGraph.create`, which is the single
  seam a future representation change has to go through.
