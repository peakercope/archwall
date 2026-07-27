/**
 * Rspack surface for ArchWall.
 *
 * Rspack and webpack expose the same compilation/moduleGraph API, so there is ONE
 * implementation — in the bundler-neutral `@archwall/bundler-plugin` — and this package
 * exists so Rspack users install an Rspack-shaped name. No logic lives here.
 *
 * The implementation used to live in this package with `@archwall/webpack` depending on
 * it, which made every webpack user install a package named after a different bundler.
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
