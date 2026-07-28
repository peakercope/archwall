# `require-tag`

Inside the paths you claim to have organised, a file with no tag is an error.

```ts
import { defineConfig, requireTag } from "archwall";

export default defineConfig({
  sourceRoot: "src",
  rules: [requireTag({ tag: "layer", within: ["**"] })],
});
```

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `tag` | `string` | *required* | The tag key every matched module must carry. |
| `within` | `string[]` | `["**"]` | Glob-lite paths, relative to `sourceRoot`. |

## Why this rule exists

Every other rule **ignores** modules it cannot classify. That is what keeps ArchWall quiet
about `node_modules` and stray files, and it is also the tool's most dangerous property: a
typo'd folder name silently escapes enforcement, and the run stays green.

This rule is the other end of that trade. It does not enforce a boundary; it enforces that
your classification actually covers the code you said it covers.

## Scope

Only `source` modules are considered, and only those whose path falls under `within`.
Anything outside `sourceRoot` is skipped — a composition root or config file you
deliberately left unclassified should be outside `within`, not fighting this rule.

## Common mistakes

- **Turning it on globally too early.** Start with `within: ["features/**"]` and widen it.
  A blanket `["**"]` on a codebase mid-migration reports every unclassified file at once.
- **Using it to find misconfiguration.** If *nothing* is classified, the run already emits a
  `no-modules-classified` diagnostic. This rule is for the partial case.

## Related

Both the [`layered()`](../presets/layered.md) and [`modules()`](../presets/modules.md)
presets add this rule when you set `strict: true`.

## Custom wording

The rule no longer takes a `message` option. Retarget the wording per instance instead —
which works for every rule, not just this one:

```ts
requireTag({ tag: "layer" }, { message: '{file} is not in any recognised layer' })
```

Placeholders are the `data` keys the rule reports: `file` and `tag`.
