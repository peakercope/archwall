/**
 * ArchWall for esbuild.
 *
 * esbuild has no module-graph hook, so unlike every other adapter this one does not observe
 * the build as it happens: it reads the **metafile** once at `onEnd`, which is the only
 * place esbuild reports what it actually linked. That single difference is what decides the
 * package's capabilities.
 */

export type {
  BuildOptionsLike,
  BuildResultLike,
  EsbuildPluginLike,
  MetafileImportLike,
  MetafileInputLike,
  MetafileLike,
  OnEndResultLike,
  PartialMessageLike,
  PluginBuildLike,
} from "./esbuild-types.js";
export type { MetafileModuleId } from "./extract.js";
export { addMetafileModules, edgeKindOf, moduleIdOf } from "./extract.js";
export type { EsbuildAdapterOptions } from "./plugin.js";
export { archwallEsbuild, default } from "./plugin.js";
