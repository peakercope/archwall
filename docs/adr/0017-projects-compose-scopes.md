# 17. `projects` composes scopes

**Date:** 2026-07-28 · **Status:** Proposed

## Decision

Configuration gains a `projects` array. Each entry names a subtree and the presets and rules that
apply to it:

```ts
defineConfig({
  repoRoot: ".",
  projects: [
    { name: "web", root: "apps/web",     presets: [fsd()] },
    { name: "api", root: "services/api", presets: [layered({ layers: [...], pure: ["domain"] })] },
    { name: "kit", root: "packages/ui",  presets: [modules()] },
  ],
  // Cross-project policy stays at the top level:
  rules: [forbiddenDependencies({ forbid: [
    { from: { tag: { project: "web" } }, to: { tag: { project: "api" } } },
  ] })],
});
```

`resolveConfig` expands each project into rule instances carrying
`scope: { include: ["<root>/**"] }`, with ids namespaced `<project>/<preset>/<rule>`, and tags every
module in the subtree with `project: <name>`.

`projects` is **config-level composition**. It introduces no new IR concept.

## Forces

`RuleScope` is the right primitive and already makes "FSD under `apps/web`, layered under
`services/api`" expressible in one config and one pass — which matters because the graph exists
only once, inside one build.

What was missing was the composition over it. `repoRoot` and `sourceRoot` are scalars, so a
40-package monorepo had two options: hand-write roughly 40 × N scoped rule instances, or run 40
separate configs. The second defeats the one-graph, one-pass property that is ArchWall's central
advantage over per-file linters. The first is what "could a large organisation comfortably maintain
hundreds of rules?" currently answers *no* to.

Tagging modules with `project` is what makes the third case — cross-project policy — expressible at
all. Without it, "the web app may not import the API's internals" has no vocabulary; with it, it is
an ordinary `ModuleMatcher` over a tag, and every existing rule works on it unchanged.

## Alternatives considered

- **One config file per package, N invocations.** Rejected: destroys the single-graph property, and
  no bundler build can run it — the plugin sees one graph, not forty.
- **`extends` plus hand-written scopes.** The status quo. Works up to about five projects, then the
  config becomes a generated artifact that nobody edits by hand.
- **A first-class `ProjectNode` in the IR.** Rejected for now: it would make every producer
  responsible for discovering project boundaries, which is exactly the kind of policy
  [ADR-0010](0010-module-kind-not-external-boolean.md) says must not live in the component that
  varies. The `workspace` module kind already carries the fact a producer can honestly know; the
  *grouping* is a configuration decision.
- **Deriving projects from `package.json` workspaces automatically.** Attractive, and can be added
  later as a `projects: "auto"` shorthand — but it must not be the only form, because a project
  boundary is an architectural choice that does not always match a publish boundary.

## Consequences

- A third id-namespacing dimension (project / preset / rule). Ids get longer; `overrides` already
  accepts globs, so `"web/fsd/*"` works naturally.
- Because ids feed fingerprints, this must land **before** baselines
  ([ADR-0016](0016-baselines-not-ignore-comments.md)) — otherwise adopting `projects` would
  invalidate every suppression.
- `project` becomes a reserved tag key. Configs already using it for something else must rename.
- The IR is untouched, so no adapter changes and no IR major.
