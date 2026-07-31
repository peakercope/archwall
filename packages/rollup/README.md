# @archwall/rollup

Rollup adapter for ArchWall, and the shared implementation for every Rollup-shaped host.

```sh
npm install --save-dev archwall @archwall/rollup
```

```ts
// rollup.config.ts — put it FIRST, so it can observe the specifiers you actually wrote
import archwall from "@archwall/rollup";

export default { plugins: [archwall(), /* resolvers… */] };
```

Rules come from `archwall.config.ts`. Part of [ArchWall](../../README.md).
