import type { GraphTransform } from "../contracts/transform.js";
import { defineTransform } from "../contracts/transform.js";

/**
 * Removes edges from a module to itself.
 *
 * This is a *semantic policy*, and it belongs in shared code a host opts into rather than
 * inside one adapter: HMR instrumentation adds self-edges (React Fast Refresh makes every
 * transformed component module import itself), and that reasoning is not Vite-specific —
 * the moment another bundler's HMR does the same thing, an adapter-local fix has to be
 * written a second time, and the two can then disagree.
 *
 * Deliberately NOT on by default: a genuine self-import is a real finding, and build mode
 * sees the real graph. A host applies this only where it knows its own instrumentation
 * created the edges.
 */
export function dropSelfEdges(): GraphTransform {
  return defineTransform({
    name: "drop-self-edges",
    transform(graph) {
      graph.removeEdges((e) => e.from === e.to);
    },
  });
}
