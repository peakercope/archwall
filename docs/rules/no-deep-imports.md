# `no-deep-imports`

Forbids raw import **specifiers** that reach past a module's public entry point.

```ts
import { defineConfig, noDeepImports } from "archwall";

export default defineConfig({
  sourceRoot: "src",
  rules: [
    noDeepImports({
      forbiddenSpecifiers: ["@/features/*/**"],
      allowedSpecifiers: ["@/features/*"],
    }),
  ],
});
```

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `forbiddenSpecifiers` | `string[]` | *required* | Glob-lite patterns matched against the raw specifier. |
| `allowedSpecifiers` | `string[]` | `[]` | Checked **first**; a match exempts the edge. |

Patterns are anchored full-matches: `*` matches within one path segment, `**` across
segments, and `{a,b}` alternates.

## Requires the `raw-specifiers` capability

This is the one rule that reads **what the author wrote** rather than what it resolved to,
so it declares `requiredCapabilities: ["raw-specifiers"]`.

Where a host cannot supply it, `rawSpecifier` falls back to the resolved id, every pattern
misses, and the rule would report a clean run. Declaring the capability turns that into a
`rule-skipped` diagnostic instead, because "no deep imports" and "ArchWall could not check
for deep imports" must not look the same.

**Who provides it**

| Host | `raw-specifiers` | Why |
|---|---|---|
| CLI | always | The scanner lexes the source, so what it records *is* what the author wrote. |
| Rspack / webpack | always | `dependency.request` is the unresolved request, on both. |
| Rollup | when the plugin is ordered **first** | `resolveId` is a first-wins hook: an adapter placed after the resolvers is never called, so it observes nothing. |
| Vite (build) | **no**, on Vite 8 | Aliases are expanded before any plugin sees the import. |
| Vite (dev) | no | The dev module graph carries no specifiers at all. |

The Rollup and Vite adapters decide this **from evidence** — whether anything was actually
captured — rather than from intent. So the rule runs where specifiers are observable and
skips loudly where they are not, without either host having to predict which case it is in.

## `no-deep-imports` vs `public-api`

They enforce the same intent from opposite ends, and neither subsumes the other:

- **This rule** looks at the specifier. It catches `@/features/auth/model/store` even when
  that file is not tagged internal — but it cannot see through a barrel or an alias.
- **[`public-api`](public-api.md)** looks at the resolved graph. It catches the import
  however it was spelled — but only if the target is classified.

Use this one when your convention is about import *style*; use `public-api` when it is
about module *structure*.
