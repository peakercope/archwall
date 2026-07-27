import type { GraphTransform } from "../contracts/transform.js";
import { defineTransform } from "../contracts/transform.js";

/**
 * Removes edges from a module to itself.
 *
 * This is a *semantic policy*, and it used to live inside the Vite adapter's dev-graph
 * builder: HMR instrumentation adds self-edges (React Fast Refresh makes every transformed
 * component module import itself), so in dev they say nothing about the author's code.
 * That reasoning is not Vite-specific — the moment Rspack HMR does the same thing, an
 * adapter-local fix has to be written a second time, and the two can then disagree.
 *
 * Policy belongs in shared code that a host opts into, which is what a transform is.
 *
 * Deliberately NOT on by default: a genuine self-import is a real finding, and build mode
 * sees the real graph. A host applies this only where it knows its own instrumentation
 * created the edges.
 */
export function dropSelfEdges(): GraphTransform {
  return defineTransform({
    name: "drop-self-edges",
    transform(graph) {
      const edges = graph.edges.filter((e) => e.from !== e.to);
      if (edges.length === graph.edges.length) return graph;
      return { ...graph, edges };
    },
  });
}
