import type { GraphComputation } from "../contracts/analysis.js";
import type { GraphView } from "../graph/query.js";

/**
 * Memoizes graph computations per (computation, view): ten unscoped rules requesting SCCs cost
 * one traversal.
 *
 * The view is part of the key because a computation is an ENUMERATION of the graph, and
 * enumeration is scoped. A cache bound to the root query
 * would hand a rule scoped to `apps/web` the cycles of the whole repository — the rule's
 * `ctx.graph` narrowed and its `ctx.compute` silently not.
 *
 * Rules sharing a scope share the base query object, so they share the entry; the common case
 * (no scope at all) is still one evaluation for everyone.
 */
export class GraphComputationCache {
  readonly #memo = new Map<GraphView, Map<GraphComputation<unknown>, unknown>>();

  get<T>(computation: GraphComputation<T>, graph: GraphView): T {
    let perView = this.#memo.get(graph);
    if (perView === undefined) {
      perView = new Map();
      this.#memo.set(graph, perView);
    }
    const key = computation as GraphComputation<unknown>;
    if (perView.has(key)) return perView.get(key) as T;
    const value = computation.compute(graph);
    perView.set(key, value);
    return value;
  }
}
