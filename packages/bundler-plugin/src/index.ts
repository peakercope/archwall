/**
 * The shared implementation for every bundler that exposes webpack's compilation and
 * module-graph API — today Rspack and webpack, tomorrow anything else that adopts it.
 *
 * It lives in a NEUTRAL package because it belongs to neither of them: `@archwall/rspack`
 * and `@archwall/webpack` are thin, equal re-export surfaces over this one, so neither
 * bundler's users install a package named after the other.
 */

export type * from "./bundler-types.js";
export { addCompilationModules, edgeKindOf, moduleIdOf } from "./extract.js";
export type { ArchWallPluginOptions } from "./plugin.js";
export { ArchWallPlugin, default } from "./plugin.js";
