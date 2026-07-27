import type { Classifier, ClassifierContext } from "../contracts/classifier.js";
import type { ModuleId, ModuleNode, ProjectGraph } from "../graph/ir.js";

/**
 * Pure: returns a NEW graph; the input is untouched. Classifiers run in order and
 * later classifiers override earlier ones on the same tag key. External modules are
 * passed to classifiers too (a classifier may tag packages).
 */
export function applyClassifiers(
  graph: ProjectGraph,
  classifiers: readonly Classifier[],
  ctx: ClassifierContext,
): ProjectGraph {
  const modules = new Map<ModuleId, ModuleNode>();
  for (const [id, m] of graph.modules) {
    const tags = new Map(m.tags);
    for (const classifier of classifiers) {
      const patch = classifier.classify(m, ctx);
      if (patch) for (const [k, v] of Object.entries(patch)) tags.set(k, v);
    }
    modules.set(id, { ...m, tags });
  }
  return { ...graph, modules };
}
