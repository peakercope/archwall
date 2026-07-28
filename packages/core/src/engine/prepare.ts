import picomatch from "picomatch";
import type { Classifier, ClassifierContext } from "../contracts/classifier.js";
import type { Diagnostic } from "../contracts/diagnostic.js";
import type { GraphTransform } from "../contracts/transform.js";
import type { Capability, ModuleId, ModuleNode, ProjectGraph } from "../graph/ir.js";
import { GraphDraft } from "../graph/ir.js";
import { sourceRelative } from "../paths.js";

/** What the project boundary needs: where sources start and which of them count. */
export interface BoundaryConfig {
  sourceRoot: string;
  include: readonly string[];
  exclude: readonly string[];
}

/** Adds what transforms need, which is the repository root they report paths against. */
export interface PrepareConfig extends BoundaryConfig {
  repoRoot: string;
}

export interface PrepareResult {
  graph: ProjectGraph;
  diagnostics: Diagnostic[];
  /** Capabilities contributed by transforms that actually ran. */
  provided: Capability[];
}

/**
 * The one pipeline: project boundary → transforms → boundary again → classification.
 *
 * The boundary belongs to the ENGINE, not to producers: producers are the component that
 * varies, so anything that must be identical across hosts cannot live in them. Producers
 * over-collect; the engine trims.
 *
 * It runs twice because a transform may ADD modules, and those must be bounded exactly as
 * if a producer had supplied them. Running it again is safe because it is idempotent — it
 * only ever re-kinds `source` → `excluded`. With no transforms configured, boundary and
 * classification are one fused pass over the modules.
 *
 * See docs/adr/0009-one-project-boundary-pipeline.md.
 *
 * Excluded modules are re-kinded, never deleted. An edge *into* an excluded file still says
 * something true about the architecture, and deleting the node would silently rewrite the
 * graph's shape (a cycle through a test helper would vanish).
 */
export function prepareGraph(
  graph: ProjectGraph,
  config: PrepareConfig,
  transforms: readonly GraphTransform[],
  classifiers: readonly Classifier[],
): PrepareResult {
  const diagnostics: Diagnostic[] = [];
  const provided: Capability[] = [];

  let current = graph;
  if (transforms.length > 0) {
    // Transforms must see which modules are actually in the project, so the boundary runs
    // before them as well as after.
    current = boundaryAndClassify(current, config, []);
    const ctx = {
      sourceRoot: config.sourceRoot,
      repoRoot: config.repoRoot,
      relative: (file: string) => sourceRelative(config.sourceRoot, file),
    };
    for (const t of transforms) {
      const draft = new GraphDraft(current);
      try {
        t.transform(draft, ctx);
        current = draft.commit();
        for (const c of t.provides ?? []) provided.push(c);
      } catch (err) {
        // The same isolation a rule gets, for the same reason: one broken enricher must not
        // destroy the run. The draft is discarded, so a transform that threw halfway leaves
        // no partial writes behind, and its capabilities are NOT added — rules depending on
        // them skip loudly rather than running against a graph that never got enriched.
        diagnostics.push({
          code: "transform-failed",
          severity: "error",
          message: `Graph transform "${t.name}" threw and was skipped: ${err instanceof Error ? err.message : String(err)}`,
          ...(err instanceof Error && err.stack !== undefined
            ? { details: { stack: err.stack } }
            : {}),
        });
      }
    }
  }

  return { graph: boundaryAndClassify(current, config, classifiers), diagnostics, provided };
}

/**
 * One pass over the modules applying both the boundary and classification.
 *
 * They do not interact — the boundary decides `kind` from the file path alone, and
 * classification decides `tags` from the node — so one pass serves both, halving the
 * per-run allocation. At 50k modules a second pass would mean another 50k node copies and
 * 50k tag Maps on every watch rebuild.
 *
 * Two further allocations are avoided: a module whose kind is unchanged AND that no
 * classifier tagged is passed through by reference, and the tag map is cloned only when a
 * classifier actually contributes something.
 */
function boundaryAndClassify(
  graph: ProjectGraph,
  config: BoundaryConfig,
  classifiers: readonly Classifier[],
): ProjectGraph {
  const isIncluded = picomatch(config.include as string[], { dot: true });
  const isExcluded = picomatch(config.exclude as string[], { dot: true });
  const ctx: ClassifierContext = {
    sourceRoot: config.sourceRoot,
    relative: (file: string) => sourceRelative(config.sourceRoot, file),
  };
  const modules = new Map<ModuleId, ModuleNode>();

  for (const m of graph.modules()) {
    // --- boundary ---------------------------------------------------------------
    // Only first-party source is subject to it. `package`/`builtin`/`virtual` are outside
    // the project by definition and already handled by `kind`; re-testing them against
    // `include` would silently reclassify every dependency as excluded.
    let node = m;
    if (m.kind === "source" && m.file !== null) {
      const rel = sourceRelative(config.sourceRoot, m.file);
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

    modules.set(m.id, tags === undefined ? node : { ...node, tags });
  }

  return graph.replaceStores(modules);
}

/**
 * The project boundary on its own, for callers that want kinds settled without tagging.
 * One implementation, shared with {@link prepareGraph}.
 */
export function applyProjectBoundary(graph: ProjectGraph, config: BoundaryConfig): ProjectGraph {
  return boundaryAndClassify(graph, config, []);
}
