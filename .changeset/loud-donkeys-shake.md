---
"@archwall/integration-kit": minor
"@archwall/test-utils": minor
"@archwall/bundler-plugin": minor
"@archwall/presets": minor
"@archwall/esbuild": minor
"@archwall/rollup": minor
"@archwall/rspack": minor
"@archwall/rules": minor
"@archwall/vite": minor
"@archwall/core": minor
"@archwall/webpack": minor
"archwall": minor
---

`UserConfig.baseline` now points at a committed file of accepted violations, keyed on
violation fingerprints. Matched findings move to `AnalysisResult.suppressed` instead of
failing the run, and the suppressed count is printed on every run. Write the file with
`archwall check --update-baseline`. See `docs/guides/brownfield-adoption.md`.

Suppression is applied at the run edge, not inside `analyze()` — the engine stays pure and
policy-free, exactly as `failOn` already is.

- New in `@archwall/core`: `parseBaseline`, `serializeBaseline`, `applyBaseline`, and the
  `BaselineFile` / `BaselineEntry` / `AppliedBaseline` types.
- New diagnostic `baseline-invalid` (a configured baseline that is missing, unparseable, or
  written under another fingerprint scheme), gated with the other configuration errors and so
  failing by default. `baseline-stale` is now emitted, and remains off by default.
- Stale entries are not reported when the run was partial — a progressive graph, or a rule
  that was skipped or crashed — because an unmatched entry is then not evidence of a fix.
- New in `@archwall/integration-kit`: `readBaseline`, `writeBaseline`, and
  `RunCheckOptions.updateBaseline`.

**Breaking:** `@archwall/core` is now a peer dependency of `@archwall/rules`,
`@archwall/presets`, `@archwall/integration-kit`, and `@archwall/test-utils`, so an install
cannot end up with two copies of core behind one graph. The adapter packages depend on it
directly; if you install `@archwall/rules` or `@archwall/test-utils` on their own, add
`@archwall/core` alongside them.
