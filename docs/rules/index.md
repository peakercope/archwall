# Built-in rules

Eight rules ship in `@archwall/rules`, re-exported from the `archwall` umbrella. Each is a
**callable rule**: pass it where a `Rule` is wanted, or call it to configure an instance.

```ts
import { defineConfig, noCycles } from "archwall";

export default defineConfig({
  sourceRoot: "src",
  //        options                    settings (id / severity / scope)
  rules: [noCycles({ maxCycleLength: 6 }, { severity: "warn" })],
});
```

Options and settings are **separate arguments** on purpose: merging them would reserve the
names `id`, `severity`, and `scope` across every rule that will ever be written.

| Rule | Enforces |
|---|---|
| [`layer-dependencies`](layer-dependencies.md) | A layer may import its own layer or a lower one. |
| [`feature-isolation`](feature-isolation.md) | Sibling slices within one layer may not import each other. |
| [`public-api`](public-api.md) | Internal modules are reachable only from within their own scope. |
| [`no-deep-imports`](no-deep-imports.md) | Written specifiers may not reach past a public entry point. |
| [`forbidden-dependencies`](forbidden-dependencies.md) | Arbitrary from/to boundaries, incl. purity. |
| [`friend-modules`](friend-modules.md) | An explicit dependency matrix between tag values. |
| [`no-cycles`](no-cycles.md) | No circular dependencies. |
| [`require-tag`](require-tag.md) | Files under given paths must be classified. |

## Three things that apply to all of them

**Scoping is the engine's job, not the rule's.** Any instance takes a `scope`, so one config
can police two subtrees differently — the monorepo case:

```ts
rules: [
  layerDependencies({ layers: [...] }, { id: "web", scope: { include: ["apps/web/**"] } }),
  layerDependencies({ layers: [...] }, { id: "api", scope: { include: ["services/api/**"] } }),
]
```

Scope selects the modules a rule is *about*. Edges **leaving** the scope are still visible,
because an import crossing out of a boundary is the most interesting thing a rule can find.

**Options are validated at config time.** Every built-in ships an `optionsSchema`, so a
missing or misspelled option produces a sentence naming it — before any graph work — rather
than a stack trace from inside the rule.

**A rule that cannot run says so.** Rules declare the host capabilities they need; where a
host cannot provide one the rule is skipped with a `rule-skipped` diagnostic instead of
quietly reporting nothing. Today only [`no-deep-imports`](no-deep-imports.md) needs one.
