# @archwall/bundler-plugin

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
  - @archwall/integration-kit@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [1321ebb]
  - @archwall/integration-kit@0.2.0

## 0.1.0

### Minor Changes

- 4415522: Initial release.

### Patch Changes

- Updated dependencies [4415522]
  - @archwall/integration-kit@0.1.0
