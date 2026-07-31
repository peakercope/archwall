# @archwall/rspack

Rspack adapter for ArchWall: an Rspack-shaped surface over
[`@archwall/bundler-plugin`](../bundler-plugin).

```sh
npm install --save-dev archwall @archwall/rspack
```

```ts
// rspack.config.ts
import ArchWallPlugin from "@archwall/rspack";

export default { plugins: [new ArchWallPlugin()] };
```

Validates at `finishModules`, which always sees the complete graph — including on watch
rebuilds — so there is no dev/build split. Violations land on `compilation.errors` or
`compilation.warnings` per `failOn`.

Rules come from `archwall.config.ts`. Part of [ArchWall](../../README.md).
