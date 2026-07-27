# @archwall/presets

Built-in architecture presets for ArchWall.

| Preset | For |
|---|---|
| `fsd()` | Feature-Sliced Design |
| `layered()` | Clean, Onion, Hexagonal, DDD-tactical, n-tier |
| `modules()` | Modular monolith, package-by-feature, vertical slices, bounded contexts |

```ts
import { defineConfig, layered } from "archwall";

export default defineConfig({
  root: "src",
  presets: [layered({ layers: ["web", "application", "domain"], pure: ["domain"] })],
});
```

A preset is a `pathClassifier` plus generic rules — no architecture-specific code. Full
documentation, recipes for other named architectures, and the honest account of what static
dependency analysis cannot prove: [`docs/presets`](../../docs/presets/index.md).

Part of [ArchWall](../../README.md).
