# 19. The interest boundary

**Date:** 2026-07-28 · **Status:** Proposed

## Decision

After the project boundary, the pipeline drops **third-party → third-party edges** unless a
configured rule opts in (`analyzeDependencies?: boolean`, default `false`).

Third-party **nodes** are kept. Rules need them as edge targets, `packageName` is load-bearing for
purity and forbidden-dependency rules, and deleting a node silently rewrites the graph's shape.

## Forces

Adapters faithfully report what their host built, which for a bundled application means every
module inside `node_modules`. React and its transitive dependencies alone contribute tens of
thousands of nodes and edges to a graph in which no configured rule can express an opinion about
any of them.

The cost is paid three times:

- **Memory.** A node per third-party module, each with its own tag map.
- **Traversal.** `no-cycles` runs Tarjan over the whole graph and then discards every component
  that turns out to be foreign — the work is done and thrown away.
- **Every future whole-graph computation** inherits the same multiplier.

The one thing an edge *into* a dependency says — "this module depends on that package" — is
preserved, because the target node stays. What is dropped is the dependency's own internal
structure, which is not the user's architecture and cannot be fixed by them.

## Alternatives considered

- **Prune in each adapter.** Rejected: six implementations of one policy, which is precisely how
  the `include`/`exclude` divergence arose — the boundary belongs to the engine
  ([ADR-0009](0009-one-project-boundary-pipeline.md)).
- **Prune nothing; optimise the consumers instead.** Partially valid — computing SCCs over the
  first-party induced subgraph is worth doing regardless — but it fixes one consumer at a time and
  leaves the memory cost untouched.
- **Drop third-party nodes entirely.** Rejected: it makes `forbidden-dependencies`,
  `layered({ pure })`, and every purity rule unable to see what they exist to check.
- **Make it unconditional, with no opt-in.** Rejected: a rule that legitimately reasons about a
  dependency's internals (a licence-boundary rule, a "this package pulls in that package" rule) has
  no other source of truth, and there is no way to reintroduce the edges once they are gone.

## Consequences

- A rule wanting dependency-internal structure must declare `analyzeDependencies`. No built-in rule
  does today.
- The saving is proportional to how much of the graph is third-party, which in a bundled
  application is most of it.
- The interest boundary runs after the project boundary and before transforms, so a transform that
  adds edges still sees a bounded graph and its contributions are bounded in turn — the same
  ordering property ADR-0009 already establishes.
- Landing this is gated on the 50k-module benchmark. It is a real optimisation, not a speculative
  one, and it should be justified by a number rather than by argument.
