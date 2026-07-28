# 7. Configuration errors are diagnostics, not throws

**Date:** 2026-07-28 · **Status:** Accepted

## Decision

`resolveConfig` reports configuration problems as `invalid-config` diagnostics and continues
with whatever is still valid. `failOnDiagnostics.invalidConfig` defaults to `true`, so the
run still fails — it just fails with results.

## Forces

`resolveConfig` threw `ArchWallError` for four cases (duplicate preset names, an ambiguous
bare rule entry, an override key matching nothing, the legacy `root` field) and emitted a
diagnostic for a fifth (invalid rule options). The same class of problem, two exits.

A throw inside a bundler's `buildEnd` surfaces as a stack trace and destroys every other
finding in the run. One mistyped `overrides` key should cost you that key, not the analysis —
which is precisely the argument the diagnostics channel was built on, applied inconsistently
to its own author.

## Alternatives

**Throw for everything, consistently.** Consistent and worse: it makes the tool brittle in
exactly the environment (a watch-mode rebuild) where a config typo is most likely.

**Diagnose everything and never fail.** Unacceptable for an enforcement tool. Hence the
gate defaulting to `true`: report everything, then fail.

## Consequences

- Duplicate preset names no longer abort. The later preset's rules are namespaced `name#2/…`
  and the collision is reported, so the outcome is stated rather than silently merged.
- An ambiguous bare rule entry is dropped, and every unambiguous rule still runs.
- Anything that genuinely cannot proceed — an unreadable config file, a circular `extends` —
  still throws, because there is no partial result to salvage.
