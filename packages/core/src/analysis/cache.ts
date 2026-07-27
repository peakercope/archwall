import type { GraphComputation } from "../contracts/analysis.js";
import type { GraphQuery } from "../graph/query.js";

/**
 * Memoizes graph computations by object identity: ten rules requesting SCCs cost one
 * traversal.
 */
export class GraphComputationCache {
  readonly #memo = new Map<GraphComputation<unknown>, unknown>();

  constructor(private readonly graph: GraphQuery) {}

  get<T>(computation: GraphComputation<T>): T {
    const key = computation as GraphComputation<unknown>;
    if (this.#memo.has(key)) return this.#memo.get(key) as T;
    const value = computation.compute(this.graph);
    this.#memo.set(key, value);
    return value;
  }
}
