# @archwall/webpack

webpack adapter for ArchWall: a webpack-shaped surface over
[`@archwall/bundler-plugin`](../bundler-plugin).

```sh
npm install --save-dev archwall @archwall/webpack
```

```ts
// webpack.config.ts
import ArchWallPlugin from "@archwall/webpack";

export default { plugins: [new ArchWallPlugin()] };
```

Validates at `finishModules`, which always sees the complete graph — including on watch
rebuilds — so there is no dev/build split. Violations land on `compilation.errors` or
`compilation.warnings` per `failOn`.

Rules come from `archwall.config.ts`. Part of [ArchWall](../../README.md).
