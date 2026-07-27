import * as path from "node:path";
import picomatch from "picomatch";
import type { ModuleId, ModuleNode, ProjectGraph } from "../graph/ir.js";

/**
 * Applies the config's `include`/`exclude` to the graph.
 *
 * This used to be the graph *producer's* job, which meant it was done by the CLI's
 * filesystem walk and by nobody else: the Vite and Rspack/webpack adapters never read
 * either field. The same config therefore analysed a bundled `.test.ts` under Vite and
 * skipped it under the CLI — the default `exclude` was enough to make the four
 * producers disagree, which falsifies the whole "one config, every surface" claim.
 *
 * The fix is structural rather than four bug fixes: producers are the component that
 * *varies*, so anything that must be identical across hosts cannot live in them.
 * Producers now over-collect and the engine trims.
 *
 * Excluded modules are re-kinded, never deleted. An edge *into* an excluded file still
 * says something true about the architecture, and deleting the node would silently
 * rewrite the graph shape (a cycle through a test helper would vanish).
 */
/**
 * Root-relative, forward-slashed, or null when the file lies outside the root.
 *
 * A file that is already relative is taken as relative *to the root* rather than
 * resolved against `process.cwd()`. Every real producer emits absolute paths, but the
 * in-memory graphs used by tests and by `@archwall/test-utils` use bare ids, and
 * resolving those against the working directory would silently place every module
 * outside the project.
 */
function relativeToRoot(root: string, file: string): string | null {
  const normalized = file.replaceAll("\\", "/");
  if (!path.isAbsolute(normalized)) return normalized;
  const rel = path.relative(root, normalized).replaceAll("\\", "/");
  return rel === "" || rel.startsWith("../") || path.isAbsolute(rel) ? null : rel;
}

export function applyProjectBoundary(
  graph: ProjectGraph,
  config: {
    sourceRoot: string;
    include: readonly string[];
    exclude: readonly string[];
  },
): ProjectGraph {
  const isIncluded = picomatch(config.include as string[], { dot: true });
  const isExcluded = picomatch(config.exclude as string[], { dot: true });

  const modules = new Map<ModuleId, ModuleNode>();
  for (const [id, m] of graph.modules) {
    // Only first-party source is subject to the boundary. `package`/`builtin`/`virtual`
    // are outside it by definition and are already handled by `kind`; re-testing them
    // against `include` would silently reclassify every dependency as excluded.
    if (m.kind !== "source" || m.file === null) {
      modules.set(id, m);
      continue;
    }
    const rel = relativeToRoot(config.sourceRoot, m.file);
    // Outside the analysed source root: not covered by the project's own include globs.
    if (rel === null || !isIncluded(rel) || isExcluded(rel)) {
      modules.set(id, { ...m, kind: "excluded" });
    } else {
      modules.set(id, m);
    }
  }
  return { ...graph, modules };
}
