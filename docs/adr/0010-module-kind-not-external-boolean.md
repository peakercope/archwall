# 10. Seven module kinds instead of `external: boolean`

**Date:** 2026-07-26 · **Status:** Accepted (recorded retroactively)

## Decision

`ModuleNode.kind` is one of `source`, `workspace`, `package`, `builtin`, `virtual`,
`unresolved`, `excluded`. There is no `external` boolean.

## Forces

`external`, defined as `kind !== "source"`, was wrong for two of the seven cases:

- A sibling **workspace** package is first-party code you can fix. Treating it as external
  made `no-cycles` skip it, so a cycle spanning two packages of your own monorepo — the most
  valuable cycle there is to report — was silently never reported.
- An **excluded** module is your own test file, so a rule matching `{ external: true }`
  matched it too.

And a purity rule that cannot tell `node:crypto` from `lodash` from `@myorg/shared-kernel`
gives the wrong answer for two of the three.

## Consequences

- `isFirstParty` / `isThirdParty` and the `FIRST_PARTY_KINDS` / `THIRD_PARTY_KINDS` lists
  name the two groupings that are actually meaningful; everything else asks about `kind`.
- Deciding a module's kind is *policy*, and lives in one place
  (`createModuleKindResolver`). Adapters supply only the facts their host knows. Three
  independent copies of that policy is how they came to disagree about `workspace` in the
  first place.
