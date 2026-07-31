# ArchWall

ArchWall validates the *actual dependency graph produced during compilation* — after aliases, barrel files, tsconfig path mappings, and module resolution have been applied — instead of guessing from source text the way ESLint-based approaches must.

- **Accurate**: rules run on the compiled module graph, so barrels and aliases can't hide a violation.
- **Bundler-agnostic**: a pure core engine fed by thin adapters — Rollup, Vite, esbuild, Rspack, and webpack, plus a standalone CLI for CI. All six build the same IR, and a shared conformance suite proves it.
- **Style-agnostic**: Feature-Sliced Design, layered architecture, Clean Architecture, or your own rules — all are presets over the same engine. Core knows tags and graph shapes, never styles.
- **Extensible**: custom rules, classifiers, presets, reporters, and adapters are plain objects passed through config; built-ins use the same public API.

## See it work

[**`examples/vite`**](examples/vite) is a small TypeScript task board with a layered architecture, its rules
written out by hand in one readable config file. It ships green, with five realistic violations commented
out — uncomment one and watch the build fail.

```sh
yarn install
yarn workspace archwall-example-vite dev      # violations logged as you edit
yarn workspace archwall-example-vite build    # violations fail the build
```

[**`examples/clean-node`**](examples/clean-node) is a Clean Architecture service validated by the
`layered` preset in six lines of config, with two seeded violations to uncomment.

```sh
yarn workspace archwall-example-clean-node check
```

## Install

`archwall` carries `defineConfig`, the presets, and the rules. Add the adapter for whatever
builds your project — or the CLI, if nothing does:

```sh
npm install --save-dev archwall @archwall/vite
```

| Your build | Adapter |
|---|---|
| Vite | [`@archwall/vite`](packages/vite) |
| Rollup | [`@archwall/rollup`](packages/rollup) |
| esbuild | [`@archwall/esbuild`](packages/esbuild) |
| Rspack | [`@archwall/rspack`](packages/rspack) |
| webpack | [`@archwall/webpack`](packages/webpack) |
| none, or CI only | [`@archwall/cli`](packages/cli) |

<details>
<summary>yarn / pnpm</summary>

```sh
yarn add --dev archwall @archwall/vite
pnpm add --save-dev archwall @archwall/vite
```

</details>

Node 22 or newer. Every package ships ESM and CJS with types, except `@archwall/vite` and
`@archwall/rollup`, which are ESM-only because their hosts are.

## Quick start

Pick a preset and you are done. `archwall.config.ts` is honored identically by the Rollup/Vite
plugin, the Rspack/webpack plugin, and the CLI:

```ts
// archwall.config.ts
import { defineConfig, fsd } from "archwall";

export default defineConfig({
  sourceRoot: "./src",
  presets: [fsd()],
});
```

Configurations compose with `extends`, and presets, rules, and reporters can be named rather
than imported — which is what makes an organisation-wide config a package rather than twenty
lines to copy into every repository:

```ts
export default defineConfig({
  extends: "@acme/archwall-config",
  presets: [["@acme/archwall-preset-platform", { strict: true }]],
});
```

Three presets ship built in — [`fsd()`](docs/presets/fsd.md) for Feature-Sliced Design,
[`layered()`](docs/presets/layered.md) for Clean/Onion/Hexagonal/DDD/n-tier, and
[`modules()`](docs/presets/modules.md) for modular monoliths, vertical slices, and bounded contexts.
See [**docs/presets**](docs/presets/index.md), and [recipes](docs/presets/recipes.md) for a ready
configuration per named architecture.

Presets compose, and every rule they contribute is namespaced so you can retune it by the exact id
printed in the error message:

```ts
import { defineConfig, fsd, noCycles } from "archwall";

export default defineConfig({
  repoRoot: ".",                             // where the REPO starts: reported paths, SARIF
  sourceRoot: "./src",                       // where the SOURCES start: globs + classifiers
  include: ["**"],                           // default: the whole tree under `sourceRoot`
  exclude: ["**/*.test.*"],
  presets: [fsd()],
  rules: [noCycles({ maxCycleLength: 6 }, { severity: "warn" })],
  overrides: { "fsd/public-api": "warn" },   // a key matching no rule is an error, not a no-op
  reporters: ["console"],                    // built-ins by name; customs by object
  failOn: "error",
});
```

There are two roots because they answer two different questions, and one field could not be
right for both:

- **`sourceRoot`** — where your sources start. The base for `include`/`exclude` and for
  classifier patterns, i.e. everything that describes the *shape* of your architecture.
  This is the one that is usually `"./src"`.
- **`repoRoot`** — where the repository starts. The base for everything that leaves the
  process: console output, JSON, violation fingerprints, and SARIF `artifactLocation.uri`.
  It defaults to the config file's directory, and it should stay there — a SARIF uri of
  `features/x.ts` when the file is really at `src/features/x.ts` is one GitHub code
  scanning cannot associate with your repository.

`include` and `exclude` are matched **relative to `sourceRoot`** — with `sourceRoot: "./src"`,
the pattern for `src/features` is `features/**`. They are applied by the engine to the module
graph, so every adapter and the CLI resolve the same project boundary from the same config.

```ts
// vite.config.ts
import archwall from "@archwall/vite";
export default { plugins: [archwall()] };
```

```ts
// rollup.config.ts — put it FIRST, so it can observe the specifiers you actually wrote
import archwall from "@archwall/rollup";
export default { plugins: [archwall(), /* resolvers… */] };
```

```ts
// build.mjs — esbuild reads its graph from the metafile, so plugin order does not matter
import archwall from "@archwall/esbuild";
await esbuild.build({ bundle: true, plugins: [archwall()], /* … */ });
```

```ts
// rspack.config.ts — identical for webpack.config.ts via @archwall/webpack
import ArchWallPlugin from "@archwall/rspack";
export default { plugins: [new ArchWallPlugin()] };
```

```sh
# or standalone, no bundler required
archwall check [--config path] [--reporter <name>] [--output <dest>] [--fail-on error|warn|never]

# `--reporter` and `--output` pair up positionally, so machine-readable output
# gets its own file and stdout is never contaminated by the human summary:
archwall check --reporter console --reporter sarif --output archwall.sarif
```

The summary line always goes to **stderr**, so `--reporter json > out.json` produces a file
that is valid JSON.

In Vite build mode the full graph is validated at `buildEnd` and can fail the build per `failOn`. In dev mode ArchWall runs progressively over the loaded subgraph, reports to the console, and never fails the dev server. **Build/CLI is the source of truth; dev mode is fast feedback.**

Rspack and webpack validate at `finishModules`, which always sees the complete graph — including on watch rebuilds — so there is no progressive mode there and no dev/build split. Violations land on `compilation.errors` or `compilation.warnings` per `failOn`.

esbuild has no module-graph hook, so its adapter validates at `onEnd` from the build's **metafile** — which it turns on for you. Two consequences follow from that being the only surface. Plugin order is irrelevant, because the metafile records what you wrote whoever resolved it, so specifier rules work wherever the plugin sits. And `bundle: true` is required for whole-graph rules: without it esbuild never follows an import, so ArchWall declines `complete-graph` and those rules skip loudly rather than reporting a clean project. Violations become esbuild errors or warnings per `failOn`.

## Packages

| Package | Role |
|---|---|
| [`@archwall/core`](packages/core) | Graph IR, engine (classify → check), rule/preset/reporter contracts |
| [`@archwall/rules`](packages/rules) | Built-in rules ([**docs**](docs/rules/index.md)): `layer-dependencies`, `forbidden-dependencies`, `public-api`, `no-deep-imports`, `feature-isolation`, `no-cycles`, `friend-modules`, `require-tag` |
| [`@archwall/presets`](packages/presets) | Built-in architecture presets: `fsd()`, `layered()`, `modules()` |
| [`@archwall/integration-kit`](packages/integration-kit) | Adapter SDK: `GraphBuilder`, `createArchWallRun`, config loading, conformance helpers |
| [`@archwall/rollup`](packages/rollup) | Rollup adapter, and the shared implementation for every Rollup-shaped host |
| [`@archwall/vite`](packages/vite) | `@archwall/rollup` in build, plus progressive dev-mode analysis |
| [`@archwall/esbuild`](packages/esbuild) | esbuild adapter, reading the graph from the build's metafile |
| [`@archwall/bundler-plugin`](packages/bundler-plugin) | Shared plugin for bundlers exposing webpack's compilation API |
| [`@archwall/rspack`](packages/rspack) | Rspack-shaped surface over `@archwall/bundler-plugin` |
| [`@archwall/webpack`](packages/webpack) | webpack-shaped surface over `@archwall/bundler-plugin` |
| [`@archwall/cli`](packages/cli) | Standalone CLI (own resolver: oxc-resolver + es-module-lexer) |
| [`@archwall/test-utils`](packages/test-utils) | Fixture graphs + assertions for the suites in this repo — internal, not published |
| [`archwall`](packages/archwall) | Umbrella: `defineConfig`, the three presets, **all eight rules**, `defineRule`, … |

## Writing a rule

A rule declares **what it wants to look at**; the engine owns the traversal, resolves each
distinct slice once, and shares it with every rule that asked for the same one.

```ts
import { defineRule } from "archwall";

export const noUpwardImports = defineRule({
  meta: {
    name: "no-upward-imports",
    description: "Modules may not import a higher layer.",
    defaultSeverity: "error",
    messages: { upward: '"{from}" may not import higher layer "{toLayer}"' },
  },
  visits: {
    edges: {
      // Only edges crossing a `layer` boundary can violate this, so only those are visited.
      filter: () => ({ crossing: "layer" }),
      visit(edge, ctx) {
        ctx.report({ edge, messageId: "upward", data: { from: edge.from, toLayer: "…" } });
      },
    },
  },
});
```

`check(ctx)` is still available for rules that genuinely need the whole graph at once —
cycle detection, reachability — but it is the exception, not the interface.

## The module graph

Rules never see raw paths. They see a graph whose nodes record **what each module is**:

| `kind` | Meaning |
|---|---|
| `source` | a first-party file inside the analysed project |
| `workspace` | a file owned by a *different* package in the same monorepo |
| `package` | a third-party dependency (node_modules) |
| `builtin` | a runtime built-in (`node:fs`, `bun:sqlite`) |
| `virtual` | generated by the toolchain; no file on disk |
| `unresolved` | the specifier resolved to nothing |
| `excluded` | a project file `exclude` removed from analysis |

This distinction is load-bearing: a purity rule that cannot tell `node:crypto` from `lodash`
from `@myorg/shared-kernel` gives the wrong answer for two of the three.

There is deliberately **no `external` boolean**. One boolean cannot express a seven-valued
distinction, and the collapse was wrong for two kinds: a sibling `workspace` package is
first-party code you can fix, and an `excluded` module is your own test file. Use
`isFirstParty(kind)` / `isThirdParty(kind)`, or the `FIRST_PARTY_KINDS` / `THIRD_PARTY_KINDS`
lists wherever a filter takes kinds.

Excluded modules stay in the graph rather than being deleted — an edge *into* an excluded file
is still a true fact, and removing the node would silently change the graph's shape.

### Module identity

A module's **id** is the IR's, not the host's:

| Scheme | For | Example |
|---|---|---|
| `file:` | `source`, `workspace`, `excluded` | `file:src/domain/rules.ts` (repo-relative) |
| `pkg:` | `package` | `pkg:react`, `pkg:@scope/pkg` |
| `builtin:` | `builtin` | `builtin:node:fs` (a bare `fs` normalises to this) |
| `virtual:` | `virtual` | `virtual:vite:preload-helper` |
| `unresolved:` | `unresolved` | `unresolved:./missing` |

Producers report host facts and `GraphBuilder` decides identity — the same division `ModuleKind`
uses. That is what makes the same finding under Vite, esbuild, Rspack, webpack, Rollup, and the
CLI carry the **same fingerprint**, which is what makes a baseline file possible.

A dependency is **one node**, not one node per file: an esbuild external is never resolved, so its
subpath is unknowable, and any scheme keeping file granularity inside a package would diverge by
host. `ModuleNode.file` still carries the absolute path for the kinds that denote a file, and
`ctx.display(id)` renders an id for humans.

### Scoping

A rule instance can be restricted to part of the graph with `scope`, applied by the engine. One
rule governs what that narrows: **enumeration is scoped; a question about a module you named is
not.** So `modules()`, `edges()`, and `ctx.compute()` see only the slice, while `module()`,
`tagOf()`, `edgesOutOf()`, and `reachableFrom()` can still answer about anything — because an edge
*leaving* the scope is the most interesting thing a scoped rule can find.

## API stability

- **Stable** (semver-major to break): config shape, rule/preset/reporter contracts, umbrella exports, the graph IR (`ModuleId` schemes, `ModuleKind`, `Edge`, capabilities), violation fingerprints.
- **Experimental** (may change in minors while maturing): graph-computation API, adapter internals beyond `createArchWallRun`, progressive-delivery semantics.

The graph's *representation* is deliberately **not** part of the IR. `ProjectGraph` is an
opaque handle read through methods, and transforms write through a mutation API — so an
interned or columnar store stays reachable without an IR major.

`EdgeKind` and `Capability` are **open** unions: new graph facts (CSS imports, worker edges,
type edges) and adapter-specific capabilities arrive additively, never as an IR major. Treat an
unrecognised kind as "some dependency exists"; never assume exhaustiveness.

Every violation carries a **`fingerprint`** — a stable, machine-independent identity derived from
the rule instance and the canonical ids of the offending locations. Deliberately *not* from the
message, so rewording a rule does not invalidate it; and deliberately not from the raw specifier or
the edge kind, both of which vary by host. Cross-producer fingerprint parity is asserted in the test
suite. It is emitted in `partialFingerprints` in SARIF and is the intended key for a future
baseline file.

A violation carries a **list** of `locations`, not one. A cycle is one finding about N files,
and every consumer — console, SARIF, a future baseline — sees all of them. It also carries
`messageId` and `data`, so a consumer never has to parse English to recover which layers or
which specifier a finding was about.

## Known limitations (v1)

- **Type-only imports are invisible.** `import type` is erased before any bundler graph exists, so type-level violations pass; the CLI deliberately skips type-only statements for parity. Complement with ESLint-side rules if you need type-edge enforcement. A future TS-aware enricher is planned as an additive capability, not an IR redesign.
- No auto-fixing, no runtime (browser) enforcement.
- **No baseline file yet.** Adopting ArchWall on an existing codebase reports everything at once, and a graph-based linter has no source text in which to put an ignore comment. Violation fingerprints ship now so the baseline can land later without changing violation identity.
- The full inventory of what static dependency analysis can and cannot prove — including why Nx-style project tags and DDD aggregate boundaries are out of scope — is in [`docs/presets/limitations.md`](docs/presets/limitations.md).
- **`no-deep-imports` does not run under Vite.** Vite 8 expands aliases before any plugin observes an import, so the adapter cannot see what the author wrote and does not claim `raw-specifiers`; the rule is skipped with a diagnostic rather than silently matching nothing. Use the CLI, Rspack/webpack, or a Rollup build with the plugin ordered first — or `public-api`, which enforces the same intent from the graph side.
- **No incremental validation.** Every run analyses the whole graph. The rule model now declares what each rule looks at, which is the prerequisite for invalidating only the rules a changed edge can affect — but the caching itself is not built.
- **The conformance fixtures are not published.** `assertGraphsMatch` and the `*_EXPECTED` sets are exported, but the fixtures they run against live in the repository, so a third-party adapter author cannot yet run the suite that defines conformance.

## Development

```sh
yarn install
yarn test         # vitest: unit, adapter conformance, and vite/cli parity suites
yarn typecheck
```

Three conformance fixtures in [`packages/integration-kit/fixtures`](packages/integration-kit/fixtures) — one per preset — seed known violations; the Vite adapter, the Rspack/webpack adapter, and the CLI are each asserted to report exactly that set, and an end-to-end parity test proves all four producers emit identical violations from the same config for all three presets. Separate smoke tests build [`examples/vite`](examples/vite) and check [`examples/clean-node`](examples/clean-node), asserting both stay green under their own contracts.
