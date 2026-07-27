# `no-cycles`

Forbids circular dependencies.

```ts
import { defineConfig, noCycles } from "archwall";

export default defineConfig({
  sourceRoot: "src",
  rules: [noCycles({ maxCycleLength: 8 }, { severity: "warn" })],
});
```

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `maxCycleLength` | `number` | `8` | **Display cap only** — how many module ids to list in the message. It does not change what is reported. |

## What counts as a cycle

Strongly connected components over **static and re-export** edges. A dynamic `import()` is a
deliberate decoupling point and is treated as a legal cycle-breaker, so it never forms one.
Self-imports are reported separately, since a one-module component does not imply a self-loop.

## What is ignored, and why

Only cycles the project **owns** are reported — first-party code, which means `source` *and*
`workspace`. A cycle entirely inside your dependencies is not your architecture, cannot be
fixed by you, and varies by how much of a package's internals a bundler exposes.

A cycle spanning two packages of your own monorepo **is** reported. It used to be skipped:
the test was a boolean `external`, defined as "not `source`", which counted a sibling
package as a third-party dependency. That was the most valuable cycle there is to report.

Modules your config `exclude`d are also skipped — they are your files, but you asked for
them to be left out.

## Cycle identity

A cycle has no single offending location, so its fingerprint hashes the **whole member set**
rather than anchoring on the alphabetically-first member. Adding an unrelated file that
sorts earlier therefore does not churn the fingerprint of an unchanged cycle — which matters
the moment baselines exist.

## Common mistakes

- **Raising `maxCycleLength` to see more cycles.** It is a message-length cap, not a filter.
- **Assuming type-only imports are excluded.** They are not, unless your toolchain elides
  them before ArchWall sees the graph. Under the CLI, `import type` is skipped; under a
  bundler it depends on your `verbatimModuleSyntax` setting.
