/**
 * Rspack surface for ArchWall.
 *
 * Rspack and webpack expose the same compilation/moduleGraph API, so there is ONE
 * implementation — in the bundler-neutral `@archwall/bundler-plugin` — and this package
 * exists so Rspack users install an Rspack-shaped name. No logic lives here.
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
