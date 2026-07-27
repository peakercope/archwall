# Recipes

Named architectures as preset configurations. Each is a complete `archwall.config.ts`.

Some styles get a preset; most get a recipe. The test is whether a style needs *different
machinery* or only *different settings* — Clean Architecture needs no rule that Onion does
not, so shipping both as presets would give you two names for one thing.

---

## Clean Architecture

Entities at the centre, then use cases, then interface adapters, then frameworks. The
Dependency Rule: source dependencies point inward only.

```ts
import { defineConfig, layered } from "archwall";

export default defineConfig({
  sourceRoot: "src",
  presets: [
    layered({
      layers: ["frameworks", "adapters", "usecases", "entities"],
      pure: ["entities", "usecases"],
      allowExternals: ["zod"],
    }),
  ],
});
```

## Onion Architecture

Same rule, different names, four rings.

```ts
layered({
  layers: ["infrastructure", "services", "domain-services", "domain-model"],
  pure: ["domain-model", "domain-services"],
});
```

## Hexagonal (Ports & Adapters)

The application core owns the ports; adapters implement them and must not know about each
other. `isolate` is what makes this hexagonal rather than merely layered.

```ts
layered({
  layers: ["adapters", "application", "domain"],
  pure: ["domain", "application"],
  isolate: ["adapters"],   // adapters/http may not import adapters/postgres
});
```

```
adapters/http ─┐
adapters/cli  ─┼─►  application  ─►  domain
adapters/db   ─┘         (ports live in domain, implemented outward)
```

⚠️ Ports are usually interfaces, and `import type` produces no edge. Read
[limitations](./limitations.md) before relying on this.

## DDD — tactical (inside one context)

```ts
layered({
  layers: ["presentation", "infrastructure", "application", "domain"],
  pure: ["domain"],
});
```

Enforceable: the domain stays free of infrastructure and libraries. Not enforceable:
aggregate boundaries, invariants, whether an entity has identity.

## DDD — strategic (context map)

Bounded contexts with an explicit map of which context may depend on which.

```ts
import { defineConfig, modules } from "archwall";

export default defineConfig({
  sourceRoot: "src",
  presets: [
    modules({
      root: "contexts",
      shared: ["shared-kernel"],
      depends: {
        ordering: ["catalogue"],
        shipping: ["ordering"],
        // catalogue depends on nothing — it is upstream of everything
      },
    }),
  ],
});
```

The `depends` map *is* the context map, kept honest by the build.

## Modular monolith

```ts
modules({
  root: "modules",
  shared: ["shared"],
  depends: { billing: ["identity"], reporting: ["billing", "identity"] },
  strict: true,
});
```

`strict: true` is worth it here: in a modular monolith, a file that belongs to no module is
usually the beginning of a new implicit one.

## Vertical Slice Architecture

Each slice is a full stack, duplication is preferred to coupling, and there is deliberately
no shared layer. That is `modules()` with `depends` and `shared` both omitted — total
isolation.

```ts
modules({ root: "features" });
```

```
features/place-order/   ─┐
features/cancel-order/  ─┼─  no arrows between them, by construction
features/view-orders/   ─┘
```

## Package by Feature

The same shape, one level up, usually with a shared kernel.

```ts
modules({ root: "features", shared: ["common"] });
```

## Package by Layer

```ts
layered({ layers: ["controllers", "services", "repositories", "models"] });
```

Honest note: this is the weakest architecture on the list, because it groups by technical
role and lets any feature touch any other at every level. ArchWall will enforce the tiers
faithfully — it just cannot give you modularity the structure does not have.

## Screaming Architecture

"Your top-level folders should name the business, not the framework." That is a naming
convention, and no import-graph tool can check it. What you *can* do is enumerate the
domain folders you consider legitimate and make anything else fail:

```ts
modules({
  root: ".",
  depends: { ordering: [], billing: [], shipping: [], catalogue: [] },
  strict: true,   // a folder that is not one of these is an error
});
```

The architecture still has to scream on its own; `strict` just stops the framework from
whispering back.

## Nx-style tag boundaries

Not a preset in v1. Nx's `depConstraints` is a tag→tag matrix over *projects*, read from
`project.json`; ArchWall's graph is a **file** graph, so there is nothing yet to hang
project tags on. The rule primitive already exists — `friendModules` is the same matrix —
so what is missing is a classifier that reads a monorepo manifest. Until then, express the
boundaries by path:

```ts
modules({ root: "libs", shared: ["shared-ui", "shared-util"], depends: { ... } });
```

## Combining presets

Presets compose. A modular monolith whose modules are each internally layered:

```ts
export default defineConfig({
  sourceRoot: "src",
  presets: [
    modules({ root: "modules", shared: ["shared"], depends: { billing: ["identity"] } }),
    layered({ root: "modules/billing", layers: ["api", "application", "domain"], pure: ["domain"] }),
  ],
});
```

Each preset's rules are namespaced (`modules/…`, `layered/…`), so they never collide even
where they use the same underlying rule.
