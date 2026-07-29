# 13. Scope semantics: enumeration is scoped, navigation is not

**Date:** 2026-07-28 · **Status:** Accepted

## Decision

A scoped `GraphQuery` follows one rule: **an operation is scoped if and only if it *enumerates*
modules or edges. An operation that answers a question about an explicitly named module is never
scoped.**

| Operation | Scoped? |
|---|---|
| `modules()`, `moduleIds()`, `moduleCount()`, `edges()` | **Yes** — they enumerate |
| `module(id)`, `has(id)`, `tagOf(id, key)` | No — you named the module |
| `edgesOutOf(id)`, `edgesInto(id)` | No — you named the module |
| `reachableFrom(id)`, `reaching(id)`, `pathBetween(a, b)` | No — traversal from a named module |
| `ModuleSelection.edgesOut/edgesIn` | Anchored: endpoints come from the selection, the edges themselves are unfiltered |
| `ctx.compute(computation)` | **Yes** — it enumerates the graph |

Each row has a test.

## Forces

`GraphQuery` documented that scope narrows `modules()` and `edges()` and deliberately did *not*
narrow `module()`, `has()`, or `tagOf()` — because an edge *leaving* the scope is the most
interesting thing a scoped rule can find, and hiding its target would break `layer-dependencies`
under scope.

It said nothing about the rest. In practice three different behaviours coexisted:

- `edgesOutOf`/`edgesInto` went straight to the shared `GraphIndex` and ignored scope.
- `reachableFrom`/`reaching`/`pathBetween` were built on those, so they traversed out of scope.
- `ctx.compute` was bound to the **root** query, so a scoped rule's computations saw the whole
  graph.

The last one was a live correctness bug: `noCycles({}, { scope: { include: ["apps/web/**"] } })`
reported cycles from `services/api`, and `no-cycles` was internally inconsistent — its SCC pass
unscoped, its self-edge pass scoped. Eight built-in rules made this survivable. Fifty rules and
third-party authors would not.

## Alternatives considered

- **Scope everything, including `module()` and `edgesOutOf()`.** Rejected: a scoped rule must be
  able to ask what an out-of-scope import target is. Hiding it turns "this module imports a higher
  layer outside my scope" — the finding you most want — into silence.
- **Scope nothing; let each rule filter.** Rejected: it moves a subtlety the engine exists to hide
  into every rule that will ever be written, and `no-cycles` already demonstrated that rule authors
  get it wrong.
- **Forbid `scope` on `check`-based rules.** Rejected: per-project cycle detection is the single
  most-requested monorepo use case, and it is expressible only through `check`.

## Consequences

- `GraphComputationCache` is keyed on `(computation, scopeKey)` and computes against the requesting
  rule's query. Unscoped rules — the common case — still share one entry, so "ten rules, one
  traversal" is preserved.
- Distinct scopes multiply computations. Scopes are few in practice and `check`-based rules are
  rarer still, so the cost is bounded.
- The rule is stated once, in the `GraphQuery` doc comment and here, rather than being rediscovered
  per method.
