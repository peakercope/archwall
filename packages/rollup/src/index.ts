/**
 * The shared implementation for every bundler that exposes Rollup's plugin API — Rollup
 * itself, Vite (whose build is Rollup), Rolldown, and anything else that adopts it.
 *
 * It lives in its own package because it belongs to none of them: every hook it uses —
 * `resolveId`, `buildEnd`, `getModuleIds`, `getModuleInfo` — is Rollup's, so `@archwall/vite`
 * consumes this and adds only dev mode.
 * See docs/adr/0008-rollup-adapter-extraction.md.
 */

export type { RollupAdapterOptions } from "./plugin.js";
export { archwallRollup, default } from "./plugin.js";
export type {
  RollupModuleInfoLike,
  RollupPluginContextLike,
  RollupPluginLike,
} from "./rollup-types.js";
