# `feature-isolation`

Forbids imports **between sibling slices within the same layer**. Vertical boundaries, where
[`layer-dependencies`](layer-dependencies.md) draws horizontal ones.

```ts
import { defineConfig, featureIsolation } from "archwall";

export default defineConfig({
  sourceRoot: "src",
  rules: [featureIsolation({ layers: ["features", "entities"] })],
});
```

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `sliceTagKey` | `string` | `"slice"` | The tag whose differing values make two modules siblings. |
| `scopeTagKey` | `string` | `"layer"` | Isolation applies only *within* a shared value of this tag. |
| `layers` | `string[]` | all | Restricts the rule to these `scopeTagKey` values. |

## How it decides

An edge is reported when all of the following hold:

1. both endpoints carry `sliceTagKey` and the values **differ**;
2. both endpoints carry the same `scopeTagKey` value — two slices in *different* layers are
   not siblings, so that is `layer-dependencies`' business, not this rule's;
3. `layers` is unset, or that shared scope value is in it.

## Common mistakes

- **Expecting it to fire across layers.** `features/cart` importing `entities/user` is not
  a sibling import; the two are in different layers. That edge is governed by layer order.
- **Using it where the boundary is a public API, not isolation.** If slices *may* depend on
  each other but only through their entry points, you want [`public-api`](public-api.md).
  If they may depend on each other only where declared, you want
  [`friend-modules`](friend-modules.md).

## Related

[`friend-modules`](friend-modules.md) is the same shape with an allow-list instead of a
blanket ban; the [`fsd()` preset](../presets/fsd.md) configures this for Feature-Sliced Design.
