import type { Capability, ProjectGraph } from "../graph/ir.js";

export interface TransformContext {
  /** Absolute source root from resolved config. */
  sourceRoot: string;
  /** Absolute repository root from resolved config. */
  repoRoot: string;
}

/**
 * A pass that may ADD to the graph, between the project boundary and classification.
 *
 * The pipeline used to be `boundary → classify → check`, with no slot for a third party —
 * or for the project's own planned TypeScript type-edge enricher — to contribute edges or
 * module metadata. "An additive capability, not an IR redesign" is only true if there is
 * somewhere to add it, and there wasn't.
 *
 * Ordered after the boundary so a transform sees which modules are actually in the project,
 * and before classification so anything it adds gets tagged like everything else.
 *
 * A transform may also declare capabilities it CONTRIBUTES. A rule requiring `type-edges`
 * should run when a transform supplies them, even though no host does — which is the whole
 * reason capabilities are a set rather than a property of the adapter.
 */
export interface GraphTransform {
  name: string;
  /**
   * Capabilities this transform adds to the graph. Declaring one is a promise that the
   * transform actually produced it; rules requiring it will now run.
   */
  provides?: Capability[];
  /**
   * Pure: return a NEW graph rather than mutating the input. A transform that throws is
   * isolated the same way a rule is — it is reported as a diagnostic and the pipeline
   * continues with the untransformed graph, because one broken enricher must not destroy
   * the whole run.
   */
  transform(graph: ProjectGraph, ctx: TransformContext): ProjectGraph;
}

export function defineTransform(transform: GraphTransform): GraphTransform {
  return transform;
}
