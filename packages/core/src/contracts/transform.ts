import type { Capability, GraphMutation } from "../graph/ir.js";

export interface TransformContext {
  /** Absolute source root from resolved config. */
  sourceRoot: string;
  /** Absolute repository root from resolved config. */
  repoRoot: string;
  /** A file's path relative to {@link sourceRoot}, or null when it lies outside. */
  relative(file: string): string | null;
}

/**
 * A pass that enriches the graph, between the project boundary and classification.
 *
 * The slot a TypeScript type-edge enricher — or any other "add facts the bundler did not
 * give us" pass — lives in. Ordered after the boundary so a transform sees which modules
 * are actually in the project, and before classification so anything it adds gets tagged
 * like everything else. Modules a transform adds are boundary-checked too: the pipeline
 * runs the boundary again over its contributions rather than trusting them.
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
   * Writes through {@link GraphMutation} rather than returning a new graph.
   *
   * Graph-in/graph-out meant every third-party transform in existence saw and
   * reconstructed the concrete representation, which froze it — and invited the whole
   * class of bug where a transform rebuilds a graph and silently drops a field it did not
   * know about. See docs/adr/0002-opaque-project-graph.md.
   *
   * A transform that throws is isolated the same way a rule is: reported as a diagnostic,
   * its partial writes discarded, and the pipeline continues — one broken enricher must
   * not destroy the whole run.
   */
  transform(graph: GraphMutation, ctx: TransformContext): void;
}

export function defineTransform(transform: GraphTransform): GraphTransform {
  return transform;
}
