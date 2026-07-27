/**
 * The shared implementation for every bundler that exposes webpack's compilation and
 * module-graph API — today Rspack and webpack, tomorrow anything else that adopts it.
 *
 * It lives in a NEUTRAL package because it belongs to neither of them. It used to live in
 * `@archwall/rspack`, with `@archwall/webpack` depending on it — so every webpack user
 * transitively installed a package named after a competitor's bundler, and the shared
 * package name told a lie the moment the two implementations needed to diverge.
 *
 * `@archwall/rspack` and `@archwall/webpack` are now both thin, equal re-export surfaces
 * over this package, which is the relationship that was true all along.
 */

export type * from "./bundler-types.js";
export { addCompilationModules, edgeKindOf, moduleIdOf } from "./extract.js";
export type { ArchWallPluginOptions } from "./plugin.js";
export { ArchWallPlugin, default } from "./plugin.js";
