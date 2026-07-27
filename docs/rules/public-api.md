# `public-api`

Enforces module entry points: a module marked **internal** may only be imported from within
its own scope. Everyone else must come through the public entry point.

```ts
import { defineConfig, publicApi } from "archwall";

export default defineConfig({
  sourceRoot: "src",
  rules: [publicApi({ scopeTagKeys: ["layer", "slice"] })],
});
```

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `visibilityTagKey` | `string` | `"visibility"` | The tag that marks internal modules. |
| `internalValue` | `string` | `"internal"` | The value of that tag meaning "internal". |
| `scopeTagKeys` | `string[]` | `["layer", "slice"]` | Importer and target must agree on **all** of these to be in the same scope. |

Classifying is what marks a module internal — typically a `pathClassifier` pattern that
tags `index.*` as `public` and everything else as `internal`. Both built-in presets that
use this rule set it up for you.

## How it decides

For every edge into a module tagged internal, the importer and the target are compared on
each key in `scopeTagKeys`. If **all** of them agree — including agreeing by both being
absent — the import is legal. Otherwise it is reported.

That "absent counts as agreement" rule is what lets a barrel work: `features/auth/index.ts`
re-exporting `features/auth/model/store.ts` shares both `layer` and `slice`, so the barrel
is legal while an import of the same file from `features/cart` is not.

## A note on re-exports

This rule deliberately does **not** require the `reexport-edges` capability. It never needs
to know an edge was a re-export, because scope agreement already covers the barrel case —
and requiring a capability a rule does not read would switch it off on hosts (Vite/Rollup)
where it works perfectly well.

## Common mistakes

- **Too few scope keys.** With `scopeTagKeys: ["layer"]` every slice in a layer can reach
  into every other slice's internals, because they agree on `layer`.
- **Nothing tagged internal.** If no module carries the visibility tag the rule matches
  nothing and reports a clean run. `no-modules-classified` warns when classification tagged
  nothing at all, but a partly-configured classifier is on you — consider
  [`require-tag`](require-tag.md).

## Related

[`no-deep-imports`](no-deep-imports.md) enforces the same intent on the *written specifier*
rather than the resolved graph; the two are complementary.
