import type { ModuleNode } from "../graph/ir.js";

export interface ClassifierContext {
  /**
   * Absolute source root from resolved config. Classifier patterns describe the shape of
   * the source tree, so they are relative to this and never to the repository root.
   */
  sourceRoot: string;
  /**
   * A file's path relative to {@link sourceRoot}, forward-slashed, or null when it lies
   * outside. Every path-based classifier needs exactly this, and none of them should be
   * re-deriving it — guards, slash normalisation and all — in user code.
   */
  relative(file: string): string | null;
}

export type TagPatch = Record<string, string> | null | undefined | void;

export interface Classifier {
  name: string;
  classify(module: ModuleNode, ctx: ClassifierContext): TagPatch;
}

export function defineClassifier(classifier: Classifier): Classifier {
  return classifier;
}
