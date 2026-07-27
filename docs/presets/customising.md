# Customising and composing presets

Presets are plain data — `{ name, classifiers, rules }` returned by a function. There is no
inheritance, no `extends`, and no string resolution. Everything below is flat configuration
applied in one pass.

## Rule instance ids

Every rule a preset contributes gets an id: `<preset>/<rule>`.

```
[error] fsd/public-api: "…/cart.ts" may not import an internal module of another slice
```

The id in the message is the key you use to change that rule. Nothing to look up.

Ids are also what make composition safe. Two presets that both configure `no-cycles` get
`fsd/no-cycles` and `modules/no-cycles` — separate instances with separate options, rather
than one entry silently overwriting the other's configuration.

## Changing severity

```ts
overrides: {
  "fsd/public-api": "warn",       // one instance
  "public-api": "warn",           // every instance of that rule, from any preset
  "fsd/*": "warn",                // everything the fsd preset contributes
}
```

## Changing options

```ts
overrides: {
  "fsd/layer-dependencies": { options: { layers: ["app", "features", "shared"] } },
  "fsd/no-cycles": { severity: "warn", options: { maxCycleLength: 4 } },
}
```

Options are merged over what the preset configured; severity is untouched unless you say so.

## Disabling a rule

```ts
overrides: { "fsd/no-cycles": "off" }
```

## Adding rules

```ts
import { forbiddenDependencies } from "@archwall/rules";

export default defineConfig({
  presets: [fsd()],
  rules: [
    forbiddenDependencies({
      forbid: [{ from: { tag: { layer: "shared" } }, to: { packageName: "lodash" } }],
    }),
  ],
});
```

A bare entry in `rules` that names a rule a preset already configures **tunes that
instance** rather than adding a second one — two instances would report every violation
twice:

```ts
presets: [fsd()],
rules: [noCycles({}, { severity: "warn" })],   // adjusts fsd/no-cycles
```

If two presets both configure that rule the reference is ambiguous, and ArchWall says so
rather than guessing. Use `overrides` with an id, or give your entry an explicit `id`:

```ts
rules: [noCycles({ maxCycleLength: 4 }, { id: "my-cycles" })],   // a genuinely separate instance
```

## Typos are errors

An `overrides` key that matches no rule throws, listing the ids that exist:

```
Override key "fsd/no-cycels" matches no configured rule.
Configured rules: fsd/feature-isolation, fsd/layer-dependencies, fsd/no-cycles, fsd/public-api.
```

A silent no-op here means believing a rule is off when it is on, or off when you meant it
on — the failure you would notice last.

## Composing presets

```ts
export default defineConfig({
  sourceRoot: "src",
  presets: [
    modules({ root: "modules", shared: ["shared"], depends: { billing: ["identity"] } }),
    layered({ root: "modules/billing", layers: ["api", "application", "domain"], pure: ["domain"] }),
  ],
});
```

Classifiers run in order and later ones win per tag key, so scope each preset to its own
`root` when combining. Rules never collide, because ids are namespaced.

## Wrapping a preset

Since a preset is a value, wrapping one is ordinary code — no framework involved:

```ts
import { definePreset, layered } from "archwall";
import { forbiddenDependencies } from "@archwall/rules";

export const houseStyle = definePreset((opts: { root?: string } = {}) => {
  const base = layered({
    root: opts.root ?? "src",
    layers: ["web", "application", "domain"],
    pure: ["domain"],
  });
  return {
    ...base,
    name: "house",     // renaming re-namespaces every rule id to house/…
    rules: [
      ...base.rules,
      forbiddenDependencies({
        id: "house/no-legacy",
        forbid: [{ from: {}, to: { packageName: "@company/legacy-*" } }],
      }),
    ],
  };
});
```

Composition, not inheritance: you hold the parts and decide what to keep.

## Building something entirely new

If no preset fits, [building blocks](./building-blocks.md) covers `pathClassifier` and the
rule vocabulary the built-ins are assembled from.
