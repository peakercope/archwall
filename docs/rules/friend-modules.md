# `friend-modules`

An explicit dependency matrix: a tag value may only import the values declared as its
friends. The rule that makes coupling a decision rather than a discovery.

```ts
import { defineConfig, friendModules } from "archwall";

export default defineConfig({
  sourceRoot: "src",
  rules: [
    friendModules({
      tagKey: "module",
      friends: { billing: ["identity"], reporting: ["billing", "identity"] },
      alwaysAllow: ["shared"],
    }),
  ],
});
```

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `tagKey` | `string` | *required* | The tag whose values are the units, e.g. `"module"` or `"slice"`. |
| `friends` | `Record<string, string[]>` | `{}` | Allow-list: importer value → permitted target values. |
| `alwaysAllow` | `string[]` | `[]` | Values every unit may import without declaring them. |

## How it decides

Only edges that **cross** a `tagKey` value are considered; same-value imports are always
legal. A crossing edge is allowed when the target's value is in `alwaysAllow`, or in
`friends[importerValue]`. Everything else is reported, and the message names what the
importer *may* reach — the useful half of the answer.

The default `friends: {}` means **every** crossing import is forbidden. That is a
deliberate starting point: declare the couplings you want, and the ones you did not
intend show up as errors.

## Common mistakes

- **Expecting it to be transitive.** `friends: { a: ["b"] }` with `b: ["c"]` does not let
  `a` import `c` — and it should not, since that is exactly the coupling you did not declare.
- **Confusing it with [`feature-isolation`](feature-isolation.md).** That rule is this one
  with an empty allow-list and no way to open a door; use it when the answer is always "no".

## Related

The [`modules()` preset](../presets/modules.md) builds this rule from its `depends` map.
