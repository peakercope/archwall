import type { ModuleNode } from "../graph/ir.js";

export interface ClassifierContext {
  /**
   * Absolute source root from resolved config. Classifier patterns describe the shape of
   * the source tree, so they are relative to this and never to the repository root.
   */
  sourceRoot: string;
}

export type TagPatch = Record<string, string> | null | undefined | void;

export interface Classifier {
  name: string;
  classify(module: ModuleNode, ctx: ClassifierContext): TagPatch;
}

export function defineClassifier(classifier: Classifier): Classifier {
  return classifier;
}
