# `layer-dependencies`

Enforces an ordering over layer tags: a module may import its **own layer or a lower one**,
never a higher one.

```ts
import { defineConfig, layerDependencies } from "archwall";

export default defineConfig({
  sourceRoot: "src",
  classifiers: [/* something that assigns a `layer` tag */],
  rules: [layerDependencies({ layers: ["presentation", "application", "domain"] })],
});
```

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `layers` | `string[]` | *required* | Layer names, **ordered highest → lowest**. |
| `tagKey` | `string` | `"layer"` | Which tag holds the layer name. |

## How it decides

Only edges that **cross** a layer boundary are considered — an import within one layer is
never a violation. Both endpoints must carry the tag and both values must appear in
`layers`; an edge touching an unlisted or untagged module is ignored rather than guessed at.

That last part is deliberate. A module you have not classified is not evidence of anything,
and inventing a position for it would report violations you cannot act on. If you want
unclassified files to be an error, that is [`require-tag`](require-tag.md)'s job.

## Common mistakes

- **Listing layers lowest-first.** The order is the dependency direction: the first entry
  may import everything after it. `["domain", "application"]` says your domain may import
  your application layer, which is the opposite of what you meant.
- **Expecting it to catch purity violations.** "domain may not import *any* package" is a
  different constraint — see [`forbidden-dependencies`](forbidden-dependencies.md), or use
  the `layered()` preset's `pure` option, which configures it for you.

## Related

[`feature-isolation`](feature-isolation.md) for horizontal boundaries within one layer;
the [`layered()` preset](../presets/layered.md), which configures this rule from a single
list of layer names.
