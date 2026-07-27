import type { GraphQuery } from "../graph/query.js";

/**
 * A memoized derived value over the graph — an SCC decomposition, a reachability table —
 * computed at most once per run and shared by every rule that asks for it.
 *
 * Named `GraphComputation` rather than `Analysis` because "analysis" already meant four
 * other things: `AnalysisResult` (the run's output), `AnalysisStats`, `AnalysisCache`, and
 * `analyze()`, plus a directory called `analysis/`. Four meanings for one word in one
 * codebase is a thing contributors conflate weekly; the run-output family keeps the name
 * and this — the odd one out — gives it up.
 */
export interface GraphComputation<T> {
  name: string;
  compute(graph: GraphQuery): T;
}

export function defineGraphComputation<T>(computation: GraphComputation<T>): GraphComputation<T> {
  return computation;
}
