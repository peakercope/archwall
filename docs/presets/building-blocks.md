# Building blocks

Presets contain no architecture-specific code. Each is a `pathClassifier` plus a handful of
generic rules — which means anything a built-in preset can express, your own configuration
can express too.

## `pathClassifier`

Turns file paths into tags. Patterns are tried in order; the first match wins.

```ts
import { pathClassifier } from "archwall";

pathClassifier({
  name: "my-architecture",
  sourceRoot: "src",
  patterns: [
    { pattern: ":layer/:slice/index.*", tags: { visibility: "public" }, only: { layer: ["features"] } },
    { pattern: ":layer/:slice/**", tags: { visibility: "internal" }, only: { layer: ["features"] } },
    { pattern: ":layer/**", only: { layer: ["features", "shared"] } },
  ],
});
```

### Pattern syntax

| Token | Matches |
|---|---|
| `:name` | exactly one path segment, captured as the tag `name` |
| `*` | any characters within one segment |
| `**` | any characters across segments |

Patterns are anchored (a full match) and relative to `root`. Captures become tags
automatically; `tags` adds literals on top.

### `only` — the important part

`only` constrains a capture to an allow-list. A value outside it means the pattern **does
not match**, so the next one is tried:

```ts
{ pattern: ":layer/:slice/index.*", tags: { visibility: "public" }, only: { layer: SLICED } }
```

Without `only`, `src/vendor/thing/index.ts` would be tagged `layer: "vendor"` and invent a
layer you never declared. With it, unknown folders fall through every pattern and stay
untagged — and every rule ignores untagged modules. That is the mechanism that keeps
ArchWall quiet about the parts of a tree you have not organised yet, and it is why
`strict` mode (via `require-tag`) exists to opt out of the quiet.

## The rules

All of these are generic: they know about tags and edges, never about architectures.

| Rule | Enforces |
|---|---|
| `layerDependencies` | ordered tag values; a module may import its own or a lower one |
| `featureIsolation` | modules with different values of a tag may not import each other |
| `friendModules` | a tag-value allow-matrix, plus `alwaysAllow` for shared units |
| `publicApi` | modules tagged internal are reachable only from within their own scope |
| `forbiddenDependencies` | arbitrary from/to matcher pairs, with an `except` carve-out |
| `noDeepImports` | patterns matched against the raw import specifier |
| `noCycles` | circular dependencies |
| `requireTag` | every file under given paths must carry a tag |

`ModuleMatcher` selects by `tag`, `external`, and `packageName` (glob-lite, single or list):

```ts
forbiddenDependencies({
  forbid: [
    {
      from: { tag: { layer: "domain" } },
      to: { external: true },
      except: { packageName: ["zod", "@company/*"] },
      message: "the domain owns your rules, not your libraries",
    },
  ],
});
```

## Writing a preset

A preset is a function returning data:

```ts
import { definePreset, pathClassifier } from "archwall";
import { layerDependencies, noCycles, publicApi } from "@archwall/rules";

export const myArchitecture = definePreset((opts: { root?: string } = {}) => ({
  name: "my-arch",
  classifiers: [
    pathClassifier({
      root: opts.root ?? "src",
      patterns: [
        { pattern: ":tier/:unit/index.*", tags: { visibility: "public" } },
        { pattern: ":tier/:unit/**", tags: { visibility: "internal" } },
        { pattern: ":tier/**" },
      ],
    }),
  ],
  rules: [
    layerDependencies({ layers: ["ui", "core", "data"], tagKey: "tier" }),
    publicApi({ scopeTagKeys: ["tier", "unit"] }),
    noCycles(),
  ],
}));
```

Use it exactly like a built-in — `presets: [myArchitecture()]` — and its rules are
namespaced `my-arch/…` automatically.

## When paths are not enough

If your architecture is not legible from file paths — tags in `package.json`, a manifest,
a naming convention inside files — write a classifier by hand. It is one function:

```ts
import { defineClassifier } from "archwall";

const byManifest = defineClassifier({
  name: "manifest",
  classify(module, ctx) {
    if (module.external || !module.file) return null;
    return { module: lookupOwner(module.file, ctx.sourceRoot) };
  },
});
```

Return `null` to leave a module untagged. Everything downstream is unchanged: the rules
neither know nor care where a tag came from.
