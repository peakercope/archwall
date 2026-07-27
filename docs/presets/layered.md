# `layered()` — ordered layers with a protected core

```ts
import { defineConfig, layered } from "archwall";

export default defineConfig({
  sourceRoot: "src",
  presets: [
    layered({
      layers: ["presentation", "infrastructure", "application", "domain"],
      pure: ["domain", "application"],
    }),
  ],
});
```

## When to use it

Your code is organised in rings or tiers with a one-way dependency rule: Clean
Architecture, Onion, Hexagonal (Ports & Adapters), DDD's tactical layering, or plain
n-tier. [Recipes](./recipes.md) gives a ready configuration for each.

These styles differ in vocabulary more than in structure. What actually distinguishes
Clean/Onion/Hexagonal from generic layering is not the layer *count* — it is the rule that
**the core must not depend on your libraries**. That is what `pure` expresses, and it is
the reason this preset exists rather than a bare list of layer names.

## Assumed structure

One directory per layer, under `root`:

```
src/
├── presentation/
├── infrastructure/
├── application/
└── domain/
```

Real trees are rarely that flat, so layers can also be a map from layer name to the
directories that hold it:

```ts
layered({
  layers: {
    presentation: "interfaces/*",
    infrastructure: ["adapters", "persistence"],
    application: "core/application",
    domain: "core/domain",
  },
});
```

Key order is the layer order. Files outside every declared layer are left unclassified and
untouched — which is how a composition root (`src/main.ts`) stays legal while wiring
everything together.

## Dependency flow

```
presentation  →  infrastructure  →  application  →  domain
                                                     ↑
                                    nothing may point away from here
```

A layer may import its own layer or any layer to its right. `pure` layers additionally
import nothing from outside the project at all.

## What it enforces

| Rule id | What it catches |
|---|---|
| `layered/layer-dependencies` | `application/audit.ts` importing `infrastructure/…` — an outward import |
| `layered/purity-<layer>` | `domain/rules.ts` importing `react`, `axios`, or `node:crypto` |
| `layered/feature-isolation` | only with `isolate` — `adapters/http` importing `adapters/db` |
| `layered/public-api` | only with `publicApi: true` — reaching past a sub-directory's `index.*` |
| `layered/no-cycles` | circular dependencies |
| `layered/require-tag` | only with `strict: true` — files under `root` in no layer |

Each pure layer gets its **own** rule id (`layered/purity-domain`,
`layered/purity-application`), so you can relax one without relaxing the others.

## Options

```ts
layered({
  root: ".",                          // where the layers live
  layers: [...] | { name: glob },     // ordered outermost→innermost
  pure: ["domain"],                   // may not reach outside the codebase
  allowExternals: ["zod", "date-fns"],// carve-outs; glob-lite, so "@company/*" works
  allowBuiltins: false,               // let a pure layer use node:* but not npm
  isolate: ["adapters"],              // siblings inside these layers can't import each other
  publicApi: false,                   // require sub-directories to expose an index.*
  strict: false,                      // unclassified files under root are errors
});
```

### `pure`, `allowExternals`, and `allowBuiltins`

`pure` forbids **npm packages and runtime built-ins alike**. That is usually what you want
for a domain layer, and it is aggressive by design: `node:crypto` is exactly the
nondeterminism Clean asks you to push to the edges. Most projects then allow a few
pure-data helpers back in:

```ts
layered({ layers: [...], pure: ["domain"], allowExternals: ["zod", "date-fns", "@company/*"] });
```

If your domain legitimately uses `node:assert` or `node:util`, relax built-ins as a class
while keeping npm dependencies forbidden:

```ts
layered({ layers: [...], pure: ["domain"], allowBuiltins: true });
```

**Sibling workspace packages are never a purity violation.** `@myorg/shared-kernel` is your
code, so an import into it is a *boundary* question — reach for `friend-modules` or
`forbiddenDependencies` — not a purity one. ArchWall distinguishes these because the module
graph records what each dependency actually is (`package`, `builtin`, `workspace`, …) rather
than a single "external" flag.

### `isolate` — the hexagonal case

In Ports & Adapters, adapters implement ports and must not know about each other.
`isolate: ["adapters"]` seals each immediate sub-directory of `adapters` from its siblings
while leaving other layers alone.

## Worked example

[`examples/clean-node`](../../examples/clean-node) is a small Clean Architecture service —
domain, ports, use cases, adapters, and a composition root — with two seeded violations you
can uncomment to watch the rules fire.

## What it cannot check

**Read this before relying on the preset for Clean or Hexagonal.**

- **`import type` is erased.** If your domain declares ports as interfaces and
  infrastructure imports them with `import type`, ArchWall sees no edge at all. Nothing
  breaks — but a `pure` domain importing `import type { PrismaClient } from "@prisma/client"`
  will **not** be flagged.
- **Direction is not inversion.** ArchWall confirms `infrastructure → domain` points
  inward. It cannot confirm the domain actually depends on an abstraction at runtime; that
  wiring lives in a DI container.
- Whether a port is a genuine abstraction or a leaky one, and whether a use case is a use
  case, remain human judgements.

Full detail in [limitations](./limitations.md).
