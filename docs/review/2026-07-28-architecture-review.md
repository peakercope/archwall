# Architecture review — road to 1.0

**Date:** 2026-07-28
**Reviewed at:** commit `14baa46`
**Scope:** the whole repository, evaluated as a framework intended to become the standard
dependency-boundary engine for the JavaScript ecosystem.

## What was reviewed

13 packages, ~13.3k LOC, six graph producers (Vite, Rollup, esbuild, Rspack, webpack, CLI),
eight rules, three presets, three reporters, eleven ADRs, 319 passing tests including a
cross-producer parity suite.

The question this review answers is **not** "is the shape right" — the shape is largely right.
It is: *which parts must be frozen, which must be broken, and in what order*, given that after
1.0 the answer to all three becomes "none of them".

---

## 1. Strengths

These are load-bearing. They should be frozen, not revisited.

| # | Strength | Why it matters at five years |
|---|---|---|
| S1 | **Capability model + `delivery`** ([ADR-0001](../adr/0001-capabilities-and-delivery.md)) | Converts "this host can't do X" from a silent false-negative into a `rule-skipped` diagnostic. The esbuild adapter refusing `complete-graph` without `bundle: true`, and Rollup claiming `raw-specifiers` from evidence rather than intent, prove the doctrine is applied rather than decorative. |
| S2 | **Opaque `ProjectGraph` + `GraphMutation`** ([ADR-0002](../adr/0002-opaque-project-graph.md)) | Representation is not part of the contract, so an interned or columnar store can land without an IR major. `GraphDraft`'s copy-on-write makes a no-op transform free. |
| S3 | **Seven-way `ModuleKind`** ([ADR-0010](../adr/0010-module-kind-not-external-boolean.md)) | `external: boolean` cannot separate `node:crypto` / `lodash` / `@myorg/kernel`, and purity rules need all three. `workspace` is what makes monorepos analysable at all. |
| S4 | **Diagnostics as a first-class channel + `failOnDiagnostics`** ([ADR-0007](../adr/0007-config-errors-as-diagnostics.md)) | A crashed rule fails the build by default. `auditClassification()` catching "0 of N modules classified" is the same instinct and is the highest-value thirty lines in the repository. |
| S5 | **Declared-interest rules, engine-owned traversal** ([ADR-0003](../adr/0003-rule-visitor-model.md)) | One slice evaluated once for every rule that wants it. Also the prerequisite for incremental validation. |
| S6 | **Engine-applied `RuleScope`** | Every rule ever written inherits scoping without knowing it exists. The difference between "monorepos need N configs" and "one config, one pass". |
| S7 | **Structural type shims** | Adapters hard-depend on no bundler. Five bundlers cost three implementations. |
| S8 | **IR-level conformance + cross-producer parity** | `graphSnapshot`/`assertGraphsMatch` compare the IR, not just violations, so an adapter cannot certify while mislabelling every dynamic import. |
| S9 | **Engine purity** | `analyze()` performs no I/O and calls no reporters. Core stays runnable in a browser or worker. |
| S10 | **`messageId` + `data` + `locations[]`** ([ADR-0004](../adr/0004-violation-locations.md), [ADR-0005](../adr/0005-message-templates.md)) | Consumers never parse English; a cycle is one finding about N files. Both hard to retrofit. |
| S11 | **ADR discipline** | "Comments state invariants, ADRs carry history" is the right convention and is actually followed. |
| S12 | **Shipped `@archwall/test-utils`** | Third-party rule authors get fixture graphs and assertions on day one. |

---

## 2. Weaknesses

### C1 (critical) — `ModuleId` has no canonical form, so fingerprints are not cross-host stable

`ModuleId` is `string`, and in practice it is whatever the host calls a module:

- Rollup/Vite: Rollup's id (usually absolute; `\0`-prefixed for virtual).
- Rspack/webpack: the absolute resource path — but `external "react"` for externals.
- esbuild: `path.resolve(root, key)` for inputs; **the bare specifier** for `external: true`.
- CLI: the oxc-resolved absolute path, so `react` becomes `…/node_modules/react/index.js`.

`fingerprintOf()` hashes `toRelative(repoRoot, edge.from)` and `…to` — the raw ids. So one
`layered/purity-domain` violation on `import "react"` fingerprints as
`…/node_modules/react/index.js` under the CLI and as `react` under esbuild.

The parity suite does not catch this: `normalize()` in `packages/cli/test/e2e-parity.test.ts` and
`rel()` in `packages/integration-kit/src/conformance.ts` collapse externals to their package name
*before* comparing. Both functions document the two branches explicitly. The leak is real; the
tests normalise it away.

**Consequence.** The README promises fingerprint stability "on two developers' machines, or under
two bundlers". That is false today for any violation touching a third-party or unresolved module.
Since the fingerprint is the declared foundation of the (unbuilt) baseline file, **the baseline
cannot be built correctly until this is fixed**, and a baseline shipped on the current scheme
would break the moment a team switched bundler or toggled `bundle`.

This is the single most expensive item to defer, because fixing it after baselines exist
invalidates every user's baseline.

### C2 (critical, bug) — `ctx.compute()` ignores the rule's scope

```ts
const query = new GraphQuery(classified);          // unscoped
const cache = new GraphComputationCache(query);    // bound to the UNSCOPED query
…
graph:   queryFor(scope, scopeKey),                // scoped
compute: (c) => cache.get(c),                      // unscoped
```

`noCycles({}, { scope: { include: ["apps/web/**"] } })` reports cycles from `services/api`. The
rule is internally inconsistent too: its SCC pass is unscoped while its self-edge pass
(`ctx.graph.edges()`) is scoped. No test covers scope together with `compute`.

### C3 (critical, contract) — `GraphQuery` scope semantics are inconsistent and unstated

The class documents that scope narrows `modules()`/`edges()` and deliberately not
`module()`/`has()`/`tagOf()`. It says nothing about `edgesOutOf`/`edgesInto` (unscoped),
`reachableFrom`/`reaching`/`pathBetween` (traverse out of scope), or
`ModuleSelection.edgesOut/edgesIn` (anchored, edges unfiltered). Three behaviours in one context,
with no stated rule. Survivable at eight rules; a bug factory at fifty with third-party authors.

### C4 (high) — The graph has no wire format

`ProjectGraph` is a class holding `Map`s; `capabilities` is a `Set`; `tags` is a `ReadonlyMap`.
There is no `toJSON`/`fromJSON`. Four capabilities depend on this one missing piece: cross-run/CI
caching, `archwall graph` / `--graph-from`, third-party and non-JS producers, and incremental
validation. For a project whose thesis is "the graph IR is the contract", the contract having no
serial form is the largest gap in the design.

### C5 (high) — `Reporter.onViolation` is documented as streaming but is not

It fires after `analyze()` completes, over the finished list — a second batch pass wearing a
streaming name. The evidence is in-tree: `consoleReporter` carries a `seen: Set<Violation>` purely
to deduplicate between the two channels.

### C6 (high) — No project/workspace dimension in configuration

"Could a large organisation comfortably maintain hundreds of rules?" currently answers *no*.
`repoRoot`/`sourceRoot` are scalars, so a 40-package monorepo needs ~40 × N hand-written scoped
instances or 40 configs — the latter defeating the one-graph, one-pass property that `RuleScope`
exists to provide. `RuleScope` is the right primitive; the composition over it is missing.

### C7 (high) — Core's public surface is large, undifferentiated, and about to be frozen

`packages/core/src/index.ts` exports ~110 symbols with no public/internal distinction, including
`GraphIndex`, `filterKey`, `prepareGraph`, `applyProjectBoundary`, `GraphComputationCache`,
`hashParts`, `stableHash`, `sourceRelative`, `toRelative` — engine internals, several exported only
because a test needed them. Each is a compatibility obligation nobody decided to take on.

### C8 (high) — `integration-kit` conflates four responsibilities

Graph construction; Node-side config loading (pulls **jiti**); the run lifecycle and pass/fail
policy; **and the conformance harness with its expected-violation sets**. Every adapter depends on
all four, so `@archwall/esbuild` ships `FSD_APP_EXPECTED` and jiti to end users. Meanwhile the
fixtures those helpers run against are unpublished, so no third-party adapter author can certify.

### C9 (medium-high) — Two pattern dialects contradict a stated invariant

`match.ts` opens with *"Matching is picomatch, everywhere … brace alternation and every other piece
of syntax means the same thing wherever a pattern appears."* It does not. `matchCaptures` — used by
`pathClassifier`, i.e. by every built-in preset — is a hand-rolled regex builder supporting
`:name`, `*`, `**` and escaping everything else including `{` and `}`. So `{app,pages}/**` is
alternation in `include`/`exclude`/`overrides` and a literal-brace match in a classifier pattern.

### C10 (medium-high) — Performance risks at 50k modules

| Risk | Where | Impact |
|---|---|---|
| One `new Map()` per module for `tags`, including every `node_modules` file | `GraphBuilder.build()` | ~50k empty Maps, dominated by modules that will never be tagged |
| Tarjan SCC over the entire graph incl. third-party interiors, then filtered by `isForeign` | `no-cycles` + `analysis/scc.ts` | Tens of thousands of nodes traversed and discarded |
| Nothing prunes third-party subgraphs | whole pipeline | >80% of a bundled graph is irrelevant to every rule |
| Full module Map re-materialised per boundary pass; twice with transforms, plus one per `GraphDraft.commit()` | `engine/prepare.ts` | Several 50k-entry Maps per watch rebuild |
| Dev mode re-analyses the whole loaded graph 200ms after every `transform()`, with no opt-out | `packages/vite` | Fine at 500 modules, pathological at 20k |

### C11 (medium) — The silence doctrine is not applied per rule

Global silence is diagnosed (`empty-project`, `no-modules-classified`) and an `overrides` key
matching nothing is an error. But a rule whose `scope` resolves to zero modules runs, reports
nothing, and passes green. A typo in `scope.include` is indistinguishable from a clean
architecture.

### C12 (medium) — The IR version check is effectively dead

`GraphBuilder` never sets `irVersion`; `ProjectGraph.create` defaults it to the `IR_VERSION` of the
core the adapter linked against, which `assertIrCompatible` then compares to the same constant from
the same module. It can only fire under a duplicated-core install, not under the adapter/core skew
it documents. The adapter must bake its IR version in at build time.

### C13 (medium) — Extension surface is inconsistent

`PresetSpec`, `RuleSpec`, and `ReporterSpec` all accept a package-name string and the loader
resolves all three. `classifiers` and `transforms` accept objects only — so no third-party
classifier package can be named, and no JSON/YAML config can ever express a classifier, which is
*the heart of a custom architecture*.

### C14 (medium) — `Preset` has no metadata

No `version`, `description`, `docsUrl`, or open `meta` bag. The interface comment correctly notes
that adding a field later breaks `satisfies Preset` authors — which is the argument for adding an
optional `meta` now, while no third-party presets exist.

### C15 (medium) — Adapter boilerplate is duplicated four times

`archwallRollup`, `ArchWallPlugin`, `archwallEsbuild`, and `cli/check.ts` each memoise a run, build
a kind resolver, build a graph, call `run.analyze`, format violations, and branch on `failed` to
pick the host's error/warning channel. ~40 near-identical lines × 4 — and exactly where future
cross-cutting concerns (timing, caching, graph export) would need adding four times.

### C16 (low-medium) — Assorted

- Failed rules keep their partial violations, contradicting the stated position that a crashed rule
  produced nothing trustworthy.
- `ctx.compute` memoises on object identity, so an inline `defineGraphComputation` silently
  recomputes every call.
- `defineDiagnostic` is a pure identity function over a plain data type with no inference value.
- Rollup's `raw-specifiers` claim freezes on the first build while the specifier map is cleared and
  repopulated per build.
- `AnalysisResult` carries no config provenance (`configFile`, `sourceRoot`, `include`, `exclude`).
- The `archwall` umbrella re-exports a hand-picked subset of core's types, so any non-trivial user
  ends up importing `@archwall/core` too.
- `ViolationInput` documents `message`/`messageId` as mutually exclusive; nothing enforces it.
- `matchesPattern`'s cache clears entirely at 500 entries rather than evicting.
- README "Known limitations" is stale — it still says a dist build is required before publishing.

---

## 3. Architectural risks

| Risk | Type | Severity | Mitigation |
|---|---|---|---|
| Fingerprint instability blocks baselines; shipping a baseline first makes it unfixable | Architectural | Critical | Canonical `ModuleId` + fingerprint v3 before any baseline work |
| Scope semantics diverge silently — wrong answers, not crashes | Architectural | Critical | Specify and test per method; bind the computation cache to the rule's query |
| IR frozen at 1.0 without a wire format | Architectural | High | Land `toJSON`/`fromJSON` + versioned envelope before freezing |
| Public surface frozen by accident | API design | High | Public/internal split + `@archwall/core/internal` before 1.0 |
| Third-party adapters cannot certify (fixtures unpublished) | Ecosystem | High | Publish `@archwall/conformance` with fixtures |
| Monorepo config does not scale | Adoption | High | First-class `projects` composition |
| No baseline — cannot adopt on an existing codebase, and a graph linter has no ignore-comment escape hatch | Adoption | High | Baseline after canonical ids |
| Perf cliff found by a user rather than by us | Performance | Medium-High | 50k-module benchmark with a CI budget |
| Every adapter carries jiti + conformance fixtures | Maintainability | Medium | Package split |
| Type-only edges invisible | Ecosystem | Medium | Already right: an additive `type-edges` capability via transform |
| Comment density is high; some comments narrate history the ADRs own | Maintainability | Low-Medium | Enforce the existing ADR convention in review |

---

## 4. Missing concepts

| Concept | Belongs? | Why |
|---|---|---|
| **Canonical `ModuleId`** | Yes — now | Without it, cross-host identity lives in a test helper. Blocks baselines. |
| **Graph wire format** (`toJSON`/`fromJSON`, versioned envelope) | Yes — before 1.0 | Unlocks caching, `archwall graph`, out-of-process analysis, non-JS producers. |
| **Baseline / suppression file** | Yes — for 1.0 | Graph linters have no source text for ignore comments. The #1 adoption blocker. |
| **`projects` config composition** | Yes — before 1.0 | The monorepo answer. `RuleScope` is the primitive; this is the composition. |
| **Interest boundary / graph pruning** | Yes | Third-party interiors are most of a real graph and matter to no rule. |
| **Graph revision identity** (content hash) | Yes | Precondition for any cross-run cache; impossible to retrofit into a frozen IR. |
| **Incremental validation** | Yes — post-1.0 | `visits` already declares interest; needs revision identity first. Do not build before 1.0. |
| **`archwall init` / `archwall explain <file>`** | Yes | `explain` is the highest-leverage DX feature and nearly free given tags already exist. |
| **Rule-matched-nothing diagnostic** | Yes — now | Closes the last silence hole. |
| **`PresetMeta`** | Yes — now | Additive later is breaking for `satisfies Preset` authors. |
| **Plugin lifecycle hooks** | Not yet | `Preset`-as-plugin is the right minimal answer. Record it in an ADR; add hooks on demand. |
| **ESLint-style `overrides: [{ files, rules }]`** | Probably not | `RuleScope` + `overrides` keys already cover it; a second mechanism would be the ESLint mistake. |
| **Auto-fix** | No | There is no source text to fix. Correctly a non-goal. |
| **Architecture metrics / health scoring** | Future | Valuable, but a different product surface — a reporter or sibling package. |
| **Graph visualisation** | Future | Falls out of the wire format for free. |

---

## 5. Code quality

Quality is high: strict TypeScript throughout (`exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`), no `any` outside one documented variance escape, a consistent
`...(x !== undefined ? { x } : {})` idiom, and comments that explain *why*.

- **Over-engineering (mild):** seven `define*` identity functions, of which only `defineRule` does
  work. `defineDiagnostic` has no inference value at all. The rest are justified by inference and
  by giving third parties a stable authoring idiom.
- **Duplication:** the adapter run/report dance (C15); `rel()` in `conformance.ts` and `normalize()`
  in `e2e-parity.test.ts` are the same function; `packages/rspack` and `packages/webpack` are
  identical modulo a comment.
- **Under-engineering:** the hand-rolled `rules/src/schema.ts` is a defensible call (no runtime dep
  on the universal install path) but is a second schema dialect that will grow — reassess at 30
  rules. `either()` reporting only the first alternative's issues produces confusing messages.
- **Hidden assumptions:** `sourceRelative` treats an already-relative path as root-relative (for
  in-memory test graphs, but it means a real producer emitting relative ids "works" with quietly
  wrong semantics); `moduleIdOf` collapses loader/query variants of one file into one node
  (intended and documented, but untested against a multi-loader config).
- **Inconsistent patterns:** three scope behaviours in one `GraphQuery` (C3); `analyze` means two
  different things — `core.analyze` is pure, `run.analyze` drives reporters and decides pass/fail.

---

## 6. Technical debt

### Dangerous — fix before it compounds

| Item | Consequence of delay | Cost now → later |
|---|---|---|
| Non-canonical `ModuleId` / fingerprints (C1) | Baselines become unfixable; a bundler switch silently invalidates every suppression | Days → breaks every user's baseline |
| Unscoped `ctx.compute` (C2) | Users trust a scoped `no-cycles` that is lying | Hours → a user-visible correctness incident |
| Undefined scope semantics (C3) | Third-party rules built on the wrong assumption | Days → cannot change without breaking rules |
| Unsplit core surface (C7) | ~60 unintended semver obligations | Days → permanent |
| `onViolation` is not streaming (C5) | Third-party reporters build on a lie | Hours → a breaking change with users attached |

### Acceptable — carry deliberately

Hand-rolled options schema (avoids a runtime dep on the universal install path; Standard Schema is
the third-party escape hatch). No incremental validation (the prerequisite is in place; building it
now would hard-code a caching model with no consumer). Type-only imports invisible (documented
non-goal with an additive path). `webpack`/`rspack` re-export shells (two package.jsons buys correct
install ergonomics). The 200ms dev debounce (isolated, easily configurable). `no-deep-imports`
skipped under Vite — this is the capability system working correctly, not debt.

---

## 7. Roadmap

Ordering rationale: **identity before persistence** (a serial form and a baseline must carry
canonical ids); **correctness before performance** (never optimise a wrong answer); **surface freeze
before ecosystem** (you cannot invite third parties onto an API you have not decided to keep);
**adoption features last**, because they are the ones that must never break once shipped.

| Milestone | Objective | Breaking? |
|---|---|---|
| **M1 Identity & correctness** | Canonical `ModuleId`, `aw3` fingerprints, scope-aware `compute`, specified scope semantics. Acceptance: the parity and conformance suites pass with their normalisation helpers **deleted**. | Yes |
| **M2 Contract hygiene** | Delete/wire `onViolation`; rename `run.analyze`; drop `defineDiagnostic`; discard failed-rule violations; `empty-scope` diagnostic; `PresetMeta`; pattern-dialect unification; adapter-baked `irVersion`. | Yes (small) |
| **M3 Surface freeze** | Public/internal split, `@archwall/core/internal`, umbrella completeness, API-surface snapshot test, `runAdapter()` across all adapters. Tag `0.9.0`. | Yes |
| **M4 Wire format** | `toJSON`/`fromJSON`, `graph.revision`, `archwall graph`, `--graph-from`, named classifiers/transforms. | No |
| **M5 Performance** | 50k-module benchmark with a CI budget, then fix what the numbers justify: `EMPTY_TAGS`, first-party SCC, interest boundary, Vite dev opt-out. | No |
| **M6 Scale & ecosystem** | `projects` composition; 40-package fixture; extract `@archwall/conformance` with published fixtures; adapter-authoring guide. | Yes (ids under `projects`) |
| **M7 Adoption** | Baseline file + `--update` + `stale-baseline`; `archwall init`; `archwall explain`; `--watch`. | No |
| **M8 1.0** | ADRs, docs, migration guide, release automation, console-reporter polish. | No |

### Prioritisation

**Critical (before any new feature):** C1 canonical ids, C2 scoped `compute`, C3 scope semantics,
C5 `onViolation`, C7 surface split.

**High:** C4 wire format, C6 `projects`, C8 published conformance, C11 `empty-scope`, baseline,
the 50k benchmark.

**Medium:** C9 pattern dialects, C10 perf fixes, C12 `irVersion`, C13 named classifiers, C14
`PresetMeta`, C15 `runAdapter`, `init`/`explain`/`--watch`, config provenance, failed-rule discard.

**Future (must not influence the current architecture):** incremental validation, TS type-edge
enricher, architecture metrics, graph visualisation, editor integration, non-JS producers, rule
inference from an existing codebase.

---

## 8. Open questions

1. **Canonical `ModuleId`, or a separate identity field?** Recommended: canonicalise `id`. A second
   `canonicalId` doubles the identity vocabulary forever; normalising only in `fingerprintOf` leaves
   ids incomparable everywhere else. *(Resolved 2026-07-28: canonicalise `id`.)*
2. **Is `RuleScope` enough for `projects`, or do projects need to be an IR concept?** Investigate
   config-level sugar first, by writing the 40-package config by hand and finding where it hurts.
3. **Does incremental validation need a different rule contract?** Prototype after M4 — *before*
   freezing the rule contract, not after.
4. **Should `check(ctx)` stay public?** It is the enemy of both incremental validation and scope
   correctness (C2 is only reachable through it). Audit whether every built-in `check` rule could be
   a `GraphComputation` + `visits`; `no-cycles` probably could.
5. **One `EdgeKind`, or kind + attributes?** CSS imports, worker edges, type edges, and
   `require` vs `import` are orthogonal axes in one open union. Revisit before the type-edge
   enricher ships — the first case where two axes genuinely collide.
6. **Is the console reporter's output the 1.0 UX?** It is what every user sees first, and it is
   currently plain and unaggregated. Grouping by rule/file with counts is the cheapest adoption win
   on the list.

---

## 9. Stability criteria

**Architecture is stable when:**

- Cross-producer parity holds on **raw ids**, with no normalisation in the test.
- Fingerprints are identical across all six producers, including violations touching third-party
  modules.
- The `GraphQuery` scope table is documented with one test per method.
- Core's public surface is enumerated, snapshot-tested, and under 60 symbols.
- The graph round-trips through JSON with byte-identical analysis results.
- A 40-package monorepo fixture is expressible in one readable config.
- A 50k-module benchmark exists with a CI budget and passes it.
- Every ADR listed in this review is written.

**1.0 ships when**, in addition:

- A versioned baseline file exists and stale entries are diagnosed.
- `@archwall/conformance` is published **with fixtures**, and a third-party adapter has been written
  against it.
- `archwall init` and `archwall explain` ship.
- Docs cover writing a rule, writing an adapter, adopting on an existing codebase, and 0.x→1.0
  migration.
- README limitations are accurate.
- `publint` + `attw` + `verify:pack` are green in CI on every PR.
- Two weeks of a release candidate pass with no breaking change required.

---

## 10. Verdict

An unusually well-designed pre-1.0 framework. The capability model, the opaque IR, the
declared-interest rule engine, and the six-producer parity suite are all things most tools in this
space never get right.

Its single most serious flaw is that **module identity was never made a property of the IR**, which
quietly falsifies the fingerprint-stability promise and blocks the one feature adoption depends on.
Fix identity first, freeze the surface second, and this architecture will still look well-designed
in five years.
