# ArchWall × Vite — worked example

A small TypeScript task board with a layered architecture, validated by ArchWall while the dev server
runs and again — as a hard failure — at build time.

No UI framework: a "component" here is a function that returns a DOM node, built with the ten-line
[`el`](src/shared/lib/dom.ts) helper in `shared/lib`. That is deliberate — ArchWall works on the module
graph, so the architecture story is identical whatever renders the pixels, and this way nothing in the
example is framework ceremony.

The architecture contract is **written out by hand** in [`archwall.config.ts`](archwall.config.ts).
Nothing is hidden behind a preset: you can read the whole thing, and every rule maps to a folder you can
see. It resembles Feature-Sliced Design because that vocabulary is familiar, but the layer names, the
slice convention, and the rules are all yours to change.

## The architecture

```
app        →  bootstrap and composition
pages      →  screens; the only place that wires features into entities
features   →  user actions ("create task", "toggle task")
entities   →  domain nouns and their state ("task", "user")
shared     →  generic building blocks with no domain knowledge
```

Two constraints, and everything else follows from them:

1. **A module may import its own layer and any layer below it — never above.**
   `features` may use `entities`; `entities` may not use `features`.
2. **Slices are isolated and speak only through their public API.**
   Inside `pages`, `features`, and `entities`, each folder is a *slice* (`features/create-task`). One
   slice may not import a sibling, and outsiders enter through the slice's `index.ts` — never a file
   beneath it.

```
src/
  app/          main.ts  App.ts  styles.css
  pages/        board/        index.ts  ui/BoardPage.ts
  features/     create-task/  index.ts  model/create-task.ts  ui/CreateTaskForm.ts
                toggle-task/  index.ts  model/toggle-task.ts  ui/ToggleTaskCheckbox.ts
  entities/     task/         index.ts  model/task.ts  model/task-store.ts  ui/TaskCard.ts
                user/         index.ts  model/user.ts  ui/UserAvatar.ts
  shared/       ui/Button.ts  lib/dom.ts  lib/format-date.ts
```

**Import convention:** inside a slice, import relatively (`../model/task`). Across slices, always
`@/<layer>/<slice>` and stop there. [`BoardPage.ts`](src/pages/board/ui/BoardPage.ts) shows why this is
enough: it composes `ToggleTaskCheckbox` (a feature) into `TaskCard` (an entity) through an `action` slot,
so neither slice has to know the other exists.

State flows the same way. [`taskStore`](src/entities/task/model/task-store.ts) belongs to the task entity
and exposes `subscribe`; the board page is what subscribes and re-renders. Features only call actions on
it — they never own the state or the rendering.

## Run it

From the repository root:

```sh
yarn install
yarn workspace archwall-example-vite dev      # http://localhost:5173
yarn workspace archwall-example-vite build    # the enforcing path
```

Both are green out of the box:

```
transforming...0 error(s), 0 warning(s) — 23 modules, 32 edges in 1ms
✓ built in 190ms
```

> **A note on `--configLoader runner`.** The `dev` and `build` scripts pass this flag. It is an artifact of
> living inside the ArchWall monorepo, where `@archwall/vite` is consumed as raw TypeScript source that
> Vite's default config loader hands straight to Node. Against a published `@archwall/vite` the scripts
> are plain `vite` and `vite build`. Nothing else about the setup changes.

## How ArchWall is configured

Two files. First, the plugin — this is the entire Vite-side integration:

```ts
// vite.config.ts
import archwall from "@archwall/vite";

export default defineConfig({
  plugins: [archwall()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});
```

`archwall()` with no arguments discovers `archwall.config.ts` next to it. Pass
`archwall({ config: "./elsewhere.ts" })` for a different path, or `archwall({ config: { … } })` to
inline the object.

> The `@` alias has to be declared **twice**: in `resolve.alias` for Vite, and in `tsconfig.json` `paths`
> for TypeScript and the ArchWall CLI. Vite does not read `paths`, and the CLI reads only `paths`.

Second, the contract itself. ArchWall has no built-in idea of a "layer" — it knows a module graph and
string **tags**. A *classifier* puts tags on modules; rules are queries over those tags:

```ts
// archwall.config.ts (abridged — read the real file, it is ~70 lines with comments)
const LAYERS = ["app", "pages", "features", "entities", "shared"];  // highest → lowest
const SLICED_LAYERS = ["pages", "features", "entities"];

const architecture = defineClassifier({
  name: "task-board",
  classify(module, ctx) {
    const rel = path.relative(ctx.sourceRoot, module.file);       // "features/create-task/model/create-task.ts"
    const [layer, slice, ...rest] = rel.split("/");
    // → { layer: "features", slice: "create-task", segment: "model", visibility: "internal" }
  },
});

export default defineConfig({
  sourceRoot: "src",
  classifiers: [architecture],
  rules: [
    layerDependencies({ layers: LAYERS }),          // reads `layer`
    featureIsolation({ layers: SLICED_LAYERS }),    // reads `slice`, scoped by `layer`
    publicApi(),                                    // reads `visibility`
    noCycles(),
  ],
  failOn: "error",
});
```

That is the whole mechanism. A module the classifier returns `null` for is untagged, and every rule
ignores untagged modules — which is how `node_modules` stays out of the way without an ignore list.

To change the architecture, change this file:

| You want | Edit |
|---|---|
| Different layer names | `LAYERS` (and rename the folders) |
| A new layer, e.g. `widgets` | add it to `LAYERS` in the right position |
| Flat layers, no slices | drop `featureIsolation` and `publicApi` |
| A rule to warn instead of fail | `overrides: { "no-cycles": "warn" }` |
| Rules ArchWall doesn't ship | `defineRule` — same API the built-ins use |

## Triggering a violation

Five mistakes ship commented out, each in the file where it would realistically be made. Select the two
code lines in a block and toggle the comment (`Cmd+/` / `Ctrl+/`).

| # | File | The mistake | Rule(s) |
|---|---|---|---|
| 1 | [`features/create-task/model/create-task.ts`](src/features/create-task/model/create-task.ts) | one feature imports another | `feature-isolation` |
| 2 | [`shared/ui/Button.ts`](src/shared/ui/Button.ts) | `shared` imports a feature | `layer-dependencies` + `no-cycles` |
| 3 | [`pages/board/ui/BoardPage.ts`](src/pages/board/ui/BoardPage.ts) | deep import past a slice's `index.ts` | `public-api` |
| 4 | [`entities/user/model/user.ts`](src/entities/user/model/user.ts) | an entity reaches up into a feature | `layer-dependencies` |
| 5 | [`entities/task/ui/TaskCard.ts`](src/entities/task/ui/TaskCard.ts) | a slice imports its own barrel | `no-cycles` |

Enable them one at a time — the table is exact, and each demo fires those rules and nothing else.

**Demo 2 fires two rules on purpose.** `features/create-task` already imports `shared/ui/Button`, so an
upward import from `Button` closes a loop. Upward dependencies almost always create cycles; that is what
layering exists to prevent, and it is worth seeing the two rules agree.

**Demo 3 is the interesting one to reason about.** `import { makeTask } from "@/entities/task/model/task"`
is valid TypeScript and resolves perfectly — `makeTask` is even part of the entity's public API. Nothing
but ArchWall objects to it, and it objects because the classifier tagged that *file*
`visibility: "internal"` and `BoardPage.ts` lives in another slice. The contract is the `index.ts`, not
the set of reachable names.

### What it looks like

Enable demo 1 and run `build`:

```
transforming...[error] feature-isolation: ".../src/features/create-task/model/create-task.ts" (slice "create-task") may not import sibling slice "toggle-task" (".../src/features/toggle-task/index.ts")
  import ".../src/features/toggle-task/index.ts"
  Slices within layer "features" are isolated; share code via a lower layer or the slice's public API.
1 error(s), 0 warning(s) — 23 modules, 33 edges in 1ms
✗ Build failed in 160ms

[plugin archwall]
RolldownError: archwall: 1 error(s), 0 warning(s) (23 modules, 33 edges)
```

The build exits non-zero — that is `failOn: "error"` doing its job in CI.

The same edit under `dev` prints the identical violation to the terminal and leaves the server running:

```
[error] feature-isolation: ".../src/features/create-task/model/create-task.ts" (slice "create-task") may not import sibling slice "toggle-task" (".../src/features/toggle-task/index.ts")
  import ".../src/features/toggle-task/index.ts"
  Slices within layer "features" are isolated; share code via a lower layer or the slice's public API.
```

## Dev vs build

|  | `dev` | `build` |
|---|---|---|
| Graph | progressive — only modules the browser has requested | complete |
| On violation | logs to the terminal | fails the build per `failOn` |
| Runs | debounced, ~200 ms after a transform | once, at `buildEnd` |

Dev is fast feedback and never breaks your server; a rule can only report on modules that happen to be
loaded. **Build and the CLI are the source of truth** — put one of them in CI.

## Without a bundler

`archwall.config.ts` is designed to be the single contract for every surface — the standalone CLI reads
the very same file, walking the filesystem with its own resolver and picking the `@` alias up from
`tsconfig.json` `paths`:

```sh
archwall check --fail-on error
```

The CLI's scanner reads this example cleanly — it walks `src/` and reports `21 modules, 30 edges`,
and enabling any of the five demos produces the same violation the build does. Being framework-free is
what buys that: the scanner uses `es-module-lexer`, which cannot parse JSX, so a `.tsx` codebase needs
the Vite adapter today.

**The one thing still missing is the `archwall` bin itself**, which awaits a dist build; see "Known
limitations" in the [root README](../../README.md). The `check()` API it wraps works now.

On a `.ts`-only codebase like this one the CLI is the richest producer of the three, carrying source
locations and raw specifiers — `"@/features/toggle-task"` at `create-task.ts:19` — that the bundler
graphs lack.

## What this example does not show

- **`no-deep-imports`.** It enforces the public-API boundary by matching the specifier you *typed*
  (`"@/entities/task/model/…"`) rather than the resolved graph, which also catches deep imports that
  resolve somewhere legal. It is not enabled here because Vite 8 expands `resolve.alias` before any plugin
  observes the import, so the adapter only ever sees the absolute path. Relative specifiers survive, and
  the CLI records raw specifiers correctly — so this rule is best used from the CLI, which does now scan
  this example. `public-api` covers the same ground from the graph side, which is why demo 3 still fails
  under `build`.
- **Type-only imports.** `import type` is erased before any bundler graph exists, so type-level edges are
  invisible to ArchWall on every surface. See the root README.
- **`forbidden-dependencies` and `friend-modules`**, two more built-in rules, for arbitrary
  from/to bans and explicit allow-lists between tagged groups.
