# @archwall/presets

## 1.0.0

### Minor Changes

- b56068e: `UserConfig.baseline` now points at a committed file of accepted violations, keyed on
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

### Patch Changes

- Updated dependencies [b56068e]
  - @archwall/rules@1.0.0
  - @archwall/core@1.0.0

## 0.2.1

### Patch Changes

- c512a8a: Fix unusable published packages. `0.1.0` and `0.2.0` should not be installed.

  Both earlier releases went to npm with manifests that were never rewritten for publishing:

  - `exports` still pointed at `./src/*.ts`, which no tarball contains — `files` is `["dist"]`. Any
    import of any package threw `ERR_MODULE_NOT_FOUND`.
  - Internal dependencies were published as `"@archwall/core": "workspace:^"`, so installing anything
    with an internal dependency failed with `EUNSUPPORTEDPROTOCOL`.

  Both fields come from Yarn features — `publishConfig.exports` and the `workspace:` protocol — that
  Yarn substitutes when it packs. Releases ran through `changeset publish`, which shells out to
  `npm publish`; npm treats `publishConfig` as npm config, warns `Unknown publishConfig config
"exports"`, and drops it. The pack smoke test never caught it because it packs with Yarn, so it was
  checking a tarball no release ever uploaded.

  Releases now pack with Yarn and upload the finished tarball with `npm publish`, which keeps the
  correct manifest and keeps OIDC trusted publishing (Yarn's own publisher has no token exchange).
  `verify:pack` gained two guards: no `workspace:` range in a publishable manifest, and every
  advertised entrypoint must exist in the tarball — including for ESM-only packages, which the CJS
  load check skips.

  `@archwall/test-utils` is published for the first time in this release.

- Updated dependencies [c512a8a]
  - @archwall/rules@0.2.1
  - @archwall/core@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [1321ebb]
  - @archwall/core@0.2.0
  - @archwall/rules@0.2.0

## 0.1.0

### Minor Changes

- 4415522: Initial release.

### Patch Changes

- Updated dependencies [4415522]
  - @archwall/core@0.1.0
  - @archwall/rules@0.1.0
