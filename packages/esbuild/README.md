# @archwall/esbuild

esbuild adapter for ArchWall, reading the module graph from the build's metafile.

```sh
npm install --save-dev archwall @archwall/esbuild
```

```ts
// build.mjs — esbuild reads its graph from the metafile, so plugin order does not matter
import archwall from "@archwall/esbuild";

await esbuild.build({ bundle: true, plugins: [archwall()] /* … */ });
```

The metafile is enabled for you. `bundle: true` is required for whole-graph rules — without it
esbuild never follows an import, so ArchWall declines `complete-graph` and those rules skip
loudly rather than reporting a clean project.

Rules come from `archwall.config.ts`. Part of [ArchWall](../../README.md).
