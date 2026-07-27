/**
 * webpack surface for ArchWall.
 *
 * Rspack and webpack expose the same compilation/moduleGraph API, so there is ONE
 * implementation — in the bundler-neutral `@archwall/bundler-plugin` — and this package
 * exists so webpack users install a webpack-shaped name. No logic lives here.
 *
 * This package used to depend on `@archwall/rspack`, so installing the webpack adapter
 * pulled in a package named after a competitor's bundler; both are now equal peers over a
 * neutral shared implementation.
 */

export type * from "@archwall/bundler-plugin";
export type { ArchWallPluginOptions } from "@archwall/bundler-plugin";
export {
  ArchWallPlugin,
  addCompilationModules,
  default,
  edgeKindOf,
  moduleIdOf,
} from "@archwall/bundler-plugin";
