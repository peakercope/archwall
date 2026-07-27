# `forbidden-dependencies`

The general-purpose boundary rule: forbids edges whose endpoints match a `from`/`to` pair of
matchers. Everything the other rules express as a specific shape, this expresses directly.

```ts
import { defineConfig, forbiddenDependencies } from "archwall";
import { THIRD_PARTY_KINDS } from "@archwall/core";

export default defineConfig({
  sourceRoot: "src",
  rules: [
    forbiddenDependencies({
      forbid: [
        {
          from: { tag: { layer: "domain" } },
          to: { moduleKind: THIRD_PARTY_KINDS },
          except: { packageName: ["zod", "date-fns"] },
          message: "the domain layer owns your rules, not your libraries",
        },
      ],
    }),
  ],
});
```

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `forbid` | `ForbiddenDependencyEntry[]` | *required* | Each entry is one rule. All are checked against every edge. |

### `ForbiddenDependencyEntry`

| Field | Type | Meaning |
|---|---|---|
| `from` | `ModuleMatcher` | Must match the importer. |
| `to` | `ModuleMatcher` | Must match the imported module. |
| `except` | `ModuleMatcher` | Checked **after** `to`; a matching target is allowed. |
| `message` | `string` | Replaces the default message. |

### `ModuleMatcher`

| Field | Type | Meaning |
|---|---|---|
| `tag` | `Record<string, string>` | **All** entries must match the module's tags. |
| `moduleKind` | `ModuleKind \| ModuleKind[]` | Any listed kind matches. |
| `packageName` | `string \| string[]` | Glob-lite, so `"@company/*"` works. |
| `workspace` | `string \| string[]` | Owning workspace package; glob-lite. |

## Why `moduleKind` and not a boolean

There is no `external: true` matcher, deliberately. A Node builtin, a sibling workspace
package, and an npm dependency are three different things to a purity rule, and one boolean
cannot say which you meant — `node:crypto` in a domain layer is not a third-party dependency,
and a sibling package in your own monorepo is code you can change.

Use `THIRD_PARTY_KINDS` (`package` + `builtin`) for "anything we do not own", or name the
kinds you mean. See [the module graph](../../README.md#the-module-graph).

## Common mistakes

- **Forgetting `except` is target-only.** It narrows `to`, not `from`.
- **Expecting entries to compose.** Each entry is independent; an edge matching two entries
  is reported twice, once per entry.

## Related

The [`layered()` preset](../presets/layered.md) generates one instance of this rule per pure
layer, which is the most common use.
