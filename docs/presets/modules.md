# `modules()` — independent modules behind public APIs

```ts
import { defineConfig, modules } from "archwall";

export default defineConfig({
  sourceRoot: "src",
  presets: [
    modules({
      root: "modules",
      shared: ["shared"],
      depends: { billing: ["identity"], reporting: ["billing", "identity"] },
    }),
  ],
});
```

## When to use it

Your codebase is a set of independent units — a modular monolith, package-by-feature,
vertical slices, bounded contexts, or feature folders. Each owns its data and logic,
exposes a deliberate surface, and depends on other units only where you have said so.

The single most valuable thing this preset does is make the **dependency matrix explicit**.
An undeclared coupling becomes a build error instead of a discovery six months later.

## Assumed structure

```
src/
├── main.ts                   # composition root — outside the module tree
└── modules/
    ├── billing/
    │   ├── index.ts          # public API
    │   └── model/invoice.ts  # internal
    ├── identity/
    │   ├── index.ts
    │   └── model/user.ts
    └── shared/
        └── index.ts
```

Every immediate sub-directory of `root` is one module. Its `index.*` is public; everything
else is internal.

Files **outside** `root` — the app shell, entry points, config — stay unclassified, so no
isolation rule constrains them. They are still held to public APIs: the shell may import
`modules/billing`, never `modules/billing/model/invoice`.

## Dependency flow

```
              main.ts  (unclassified: may reach any module's public API)
                 │
    ┌────────────┼────────────┐
    ▼            ▼            ▼
 billing ───► identity    reporting        declared edges only
    │            │            │
    └────────────┴────────────┘
                 ▼
              shared                       reachable by everyone
```

## What it enforces

| Rule id | What it catches |
|---|---|
| `modules/friend-modules` | `reporting` importing `billing` when the matrix does not allow it |
| `modules/public-api` | anything reaching past a module's `index.*` into its internals |
| `modules/no-cycles` | circular dependencies |
| `modules/require-tag` | only with `strict: true` — loose files directly under `root` |

## Options

```ts
modules({
  root: ".",                            // directory whose sub-directories are the modules
  shared: ["shared"],                   // importable by every module, no declaration needed
  depends: { billing: ["identity"] },   // the dependency matrix; omit for total isolation
  publicApi: true,                      // internals are unreachable from outside
  strict: false,
});
```

### The matrix

Omit `depends` and **no module may import any other** — total isolation, the vertical-slice
default. Supply it and a module may import exactly what it lists, plus anything in `shared`:

```ts
modules({ depends: { billing: ["identity"] } });
// billing → identity   ✓ declared
// identity → billing   ✗ not declared (the matrix is directional)
// reporting → billing  ✗ reporting declares nothing
```

This is a bounded-context map in configuration form. Adding an edge to it is the moment to
ask whether the coupling is one you want.

### Turning off public APIs

`publicApi: false` drops `modules/public-api`, leaving only the dependency matrix. Useful
when adopting the preset on a codebase that has no barrels yet — get the matrix passing
first, then turn public APIs back on.

## Recipes

Modular monolith, vertical slice, package-by-feature, screaming architecture, and DDD
bounded contexts are all this preset with different settings. See [recipes](./recipes.md).

## What it cannot check

- **DDD aggregate boundaries.** "Reference other aggregates by ID, never by object
  reference" is a rule about code shape, not about imports; the import looks identical
  either way.
- **Whether a module name means anything.** Screaming Architecture asks that your top-level
  folders name the business domain. Listing them in `depends` documents the intent, but no
  tool can tell `billing` from `utils2`.
- Runtime coupling through an event bus, DI container, or service locator. Those edges do
  not exist in the import graph — which is often exactly why they were chosen.

See [limitations](./limitations.md).
