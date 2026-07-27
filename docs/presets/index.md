# Architecture presets

A preset is a named architecture: a **classifier** that reads structure out of your file
paths, plus the **rules** that structure implies. Three ship with ArchWall.

```ts
import { defineConfig, fsd } from "archwall";

export default defineConfig({
  sourceRoot: "src",
  presets: [fsd()],
});
```

That is the whole configuration. No rule wiring, no classifier to write.

## Choosing one

| Your codebase | Preset |
|---|---|
| Frontend organised as `app / pages / widgets / features / entities / shared` | [`fsd()`](./fsd.md) |
| Ordered layers with a protected core — Clean, Onion, Hexagonal, DDD-tactical, plain layering | [`layered()`](./layered.md) |
| Independent modules that talk through public APIs — modular monolith, package-by-feature, vertical slices, bounded contexts | [`modules()`](./modules.md) |

Most named architectures are one of these three shapes wearing different vocabulary.
Clean, Onion, and Hexagonal, for instance, differ from each other in layer *names* and
ring count, not in structure — so they are configurations of `layered()`, written out in
[recipes](./recipes.md), rather than three near-identical presets.

If none fits, presets are ordinary data. [Build your own](./building-blocks.md) from the
same parts these are made of.

## What a preset can and cannot prove

ArchWall reads the **import graph**. That makes it exact about one question — *which
module may reach which* — and silent on everything else.

Enforceable, and enforced by these presets:

- direction of dependencies between layers
- isolation between sibling features, modules, or slices
- reachability only through a module's public API
- dependencies on third-party packages, per layer
- circular dependencies

Not enforceable, by any import-graph tool, and deliberately not promised:

- that a class is really an *entity*, a *use case*, or an *aggregate*
- that dependency **inversion** happened, as opposed to dependency **direction** —
  ArchWall sees `infrastructure → domain` and confirms the arrow points inward, but the
  runtime wiring that makes it an inversion happens in a DI container it cannot see
- DDD aggregate boundaries ("reference other aggregates by ID, never by object reference")
- naming conventions, layer *contents*, or whether a folder deserves its name

One limitation deserves attention before you adopt any preset:
**`import type` is erased before the graph exists**, so type-only dependencies are
invisible. Read [limitations](./limitations.md) — it matters most for exactly the
architectures where ports are interfaces.

## Customising

Presets compose. You can run more than one, add rules, retune options, and switch rules
off — all through flat configuration, with no inheritance:

```ts
export default defineConfig({
  presets: [fsd({ src: "src" })],
  rules: [noCycles({}, { severity: "warn" })],
  overrides: {
    "fsd/public-api": "warn",
    "fsd/layer-dependencies": { options: { layers: ["app", "features", "shared"] } },
  },
});
```

Every rule a preset contributes has an **id** of the form `<preset>/<rule>`, and that id
is what ArchWall prints in the error message — so the string you need for `overrides` is
always the one already in front of you. A key that matches nothing is an error, not a
silent no-op.

See [customising presets](./customising.md) for the full mechanism.
