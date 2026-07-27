import * as path from "node:path";
import picomatch from "picomatch";
import type { Classifier, ClassifierContext } from "../contracts/classifier.js";
import type { ModuleId, ModuleNode, ProjectGraph } from "../graph/ir.js";

/**
 * The project boundary and classification, FUSED into one pass.
 *
 * They used to be two, and each rebuilt the entire module map: two full copies plus one
 * new `Map` per module for its tags, on every watch rebuild. At 50k modules that is ~100k
 * allocations and 50k Maps per run, for a pipeline whose stated budget is a single-digit
 * percentage of build time.
 *
 * Fusing them is safe because they never interacted: the boundary decides `kind` from the
 * file path alone, and classification decides `tags` from the node — and a classifier only
 * ever sees `kind: "source"` modules through `pathClassifier`'s own guard, which the
 * boundary has already settled by the time tags are computed for that same module.
 *
 * Two further allocations are avoided:
 *  - a module whose kind is unchanged AND that no classifier tagged is passed through by
 *    reference rather than copied;
 *  - the tag map is only cloned when a classifier actually contributes something.
 *
 * ## Why the boundary is here at all
 *
 * This used to be the graph *producer's* job, which meant it was done by the CLI's
 * filesystem walk and by nobody else: the Vite and Rspack/webpack adapters never read
 * `include`/`exclude`. The same config therefore analysed a bundled `.test.ts` under Vite
 * and skipped it under the CLI — the default `exclude` alone was enough to make the four
 * producers disagree, which falsifies the whole "one config, every surface" claim.
 *
 * The fix is structural rather than four bug fixes: producers are the component that
 * *varies*, so anything that must be identical across hosts cannot live in them. Producers
 * over-collect and the engine trims.
 *
 * Excluded modules are re-kinded, never deleted. An edge *into* an excluded file still says
 * something true about the architecture, and deleting the node would silently rewrite the
 * graph shape (a cycle through a test helper would vanish).
 */

/**
 * Root-relative, forward-slashed, or null when the file lies outside the root.
 *
 * A file that is already relative is taken as relative *to the root* rather than resolved
 * against `process.cwd()`. Every real producer emits absolute paths, but the in-memory
 * graphs used by tests and by `@archwall/test-utils` use bare ids, and resolving those
 * against the working directory would silently place every module outside the project.
 */
function relativeToRoot(root: string, file: string): string | null {
  const normalized = file.replaceAll("\\", "/");
  if (!path.isAbsolute(normalized)) return normalized;
  const rel = path.relative(root, normalized).replaceAll("\\", "/");
  return rel === "" || rel.startsWith("../") || path.isAbsolute(rel) ? null : rel;
}

export interface PrepareConfig {
  sourceRoot: string;
  include: readonly string[];
  exclude: readonly string[];
}

export function prepareGraph(
  graph: ProjectGraph,
  config: PrepareConfig,
  classifiers: readonly Classifier[],
  ctx: ClassifierContext,
): ProjectGraph {
  const isIncluded = picomatch(config.include as string[], { dot: true });
  const isExcluded = picomatch(config.exclude as string[], { dot: true });
  const modules = new Map<ModuleId, ModuleNode>();

  for (const [id, m] of graph.modules) {
    // --- boundary ---------------------------------------------------------------
    // Only first-party source is subject to the boundary. `package`/`builtin`/`virtual`
    // are outside it by definition and are already handled by `kind`; re-testing them
    // against `include` would silently reclassify every dependency as excluded.
    let node = m;
    if (m.kind === "source" && m.file !== null) {
      const rel = relativeToRoot(config.sourceRoot, m.file);
      // Outside the analysed source root: not covered by the project's own include globs.
      if (rel === null || !isIncluded(rel) || isExcluded(rel)) {
        node = { ...m, kind: "excluded" };
      }
    }

    // --- classification ---------------------------------------------------------
    // Later classifiers override earlier ones on the same tag key. Every module is offered
    // to every classifier — a classifier may legitimately tag packages.
    let tags: Map<string, string> | undefined;
    for (const classifier of classifiers) {
      const patch = classifier.classify(node, ctx);
      if (!patch) continue;
      tags ??= new Map(node.tags);
      for (const [k, v] of Object.entries(patch)) tags.set(k, v);
    }

    // Untouched by both passes: keep the original node instead of allocating a copy.
    modules.set(id, tags === undefined ? node : { ...node, tags });
  }

  return { ...graph, modules };
}
