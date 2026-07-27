# `fsd()` — Feature-Sliced Design

```ts
import { defineConfig, fsd } from "archwall";

export default defineConfig({ sourceRoot: "src", presets: [fsd()] });
```

## When to use it

Your frontend follows [Feature-Sliced Design](https://feature-sliced.design): top-level
layers, slices inside them, segments inside those, and an `index.ts` as each slice's
public API.

FSD is the best static-analysis fit of any architecture ArchWall supports, because FSD
is not a metaphor — it is a filesystem specification with a written dependency rule.
Almost everything it asks of you is visible in the import graph.

## Assumed structure

```
src/
├── app/                      # unsliced
├── pages/
│   └── checkout/
│       ├── index.ts          # public API
│       ├── ui/               # segments
│       └── model/
├── widgets/
├── features/
│   └── cart/
│       ├── index.ts
│       ├── @x/               # cross-import API (optional)
│       │   └── auth.ts
│       └── model/
├── entities/
└── shared/                   # unsliced
```

`app` and `shared` have no slices; the four middle layers do. A file's tags come from its
position: `layer` from the first segment, `slice` from the second, `segment` from the
third, and `visibility` = `public` for `index.*` and `@x/*`, `internal` for everything else.

## Dependency flow

```
app  →  pages  →  widgets  →  features  →  entities  →  shared
```

Every arrow points one way. A layer may import its own layer or any layer to its right,
never to its left. Within a layer, slices are sealed off from each other.

## What it enforces

| Rule id | What it catches |
|---|---|
| `fsd/layer-dependencies` | `shared/lib/x.ts` importing `features/cart` — an upward import |
| `fsd/feature-isolation` | `features/cart` importing `features/auth` — siblings are independent |
| `fsd/public-api` | `features/auth/model/store.ts` imported from outside the slice — reach through `index.ts` |
| `fsd/no-cycles` | circular dependencies |
| `fsd/require-tag` | only with `strict: true` — files under `src` in no layer at all |

## Options

```ts
fsd({
  src: ".",              // FSD root, relative to config sourceRoot
  layers: [...],         // ordered highest→lowest; default the six canonical layers
  slicedLayers: [...],   // default: all configured layers except app and shared
  crossImports: {...},   // see below
  strict: false,
})
```

### Cross-imports (`@x`)

FSD permits one entity to know about another through an explicit `@x` public API. Declare
which slices may reach which, and the blanket sibling ban is replaced by your allow-list:

```ts
fsd({ crossImports: { cart: ["auth"], checkout: ["cart", "auth"] } });
```

`cart` may now import `auth`; every other pairing is still forbidden, and a slice absent
from the map may import no siblings at all. This *replaces* `fsd/feature-isolation` with
`fsd/friend-modules` rather than adding to it, so a bad import is still reported once.

### Strict mode

`strict: true` adds `fsd/require-tag`: any file under `src` that lands in no layer is an
error. Without it such files are simply ignored — which is what keeps ArchWall quiet
about stray scripts, but also means a typo'd folder name silently escapes every rule.
Turn it on once your tree is clean.

## Worked example

[`examples/vite`](../../examples/vite) is a TypeScript task board in FSD layout, with the
equivalent contract written by hand so you can see what the preset does for you.

## What it cannot check

Whether a "feature" is genuinely a feature, whether logic sits in the right segment, or
whether your slice names mean anything. Those are review conversations. See
[limitations](./limitations.md).
