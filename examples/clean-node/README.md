# examples/clean-node

A small Clean Architecture service — domain, ports, use cases, adapters, composition root —
validated by the [`layered`](../../docs/presets/layered.md) preset with no bundler involved.

```sh
yarn install
yarn workspace archwall-example-clean-node check
```

It ships green.

## The architecture

```
src/
├── main.ts                    composition root (deliberately unclassified)
├── presentation/              HTTP shape in, HTTP shape out
│   └── register-route.ts
├── infrastructure/            adapters: repository, clock, ids
│   ├── in-memory-user-repository.ts
│   └── system-clock.ts
├── application/               use cases
│   └── register-user.ts
└── domain/                    entities, invariants, ports
    ├── user.ts
    ├── ports.ts
    └── registration.ts
```

```
presentation  →  infrastructure  →  application  →  domain
                       │                               ▲
                       └───── implements ports ────────┘
```

`main.ts` sits outside every layer, so the preset leaves it unclassified and no dependency
rule applies. That is intentional: a composition root that could not reach across layers
could not compose anything.

## The whole configuration

```ts
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

Four names and one purity declaration. The classifier, the four rules, and the messages all
come from the preset.

## Triggering a violation

Two imports are commented out with a `// Try it:` note. Uncomment either:

**`src/application/register-user.ts`** — a use case importing a concrete adapter instead of
the port:

```
[error] layered/layer-dependencies: "…/application/register-user.ts" (layer "application")
        may not import from higher layer "infrastructure"
  at …/src/application/register-user.ts:6:0
  import "@/infrastructure/in-memory-user-repository" → resolves to …
  Configured layer order (highest first): presentation → infrastructure → application → domain.
```

**`src/domain/registration.ts`** — the domain reaching for a Node built-in:

```
[error] layered/purity-domain: "domain" must not depend on third-party packages —
        it is the part of the system that owns your rules, not your libraries
  at …/src/domain/registration.ts:5:0
  import "node:crypto"
```

The rule id in each message (`layered/purity-domain`) is exactly the key you would put in
`overrides` to retune it.

## What this example does not show

`src/domain/ports.ts` declares the interfaces infrastructure implements — and because they
are imported with `import type`, **ArchWall sees no edge for them at all**. The direction
it does check is real; the inversion is not something an import graph can prove. See
[limitations](../../docs/presets/limitations.md).
