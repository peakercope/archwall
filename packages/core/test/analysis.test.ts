import type { Edge, ModuleKind, ModuleNode } from "@archwall/core";
import {
  defineGraphComputation,
  GraphQuery,
  ProjectGraph,
  stronglyConnectedComponents,
} from "@archwall/core";
import { GraphComputationCache } from "@archwall/core/internal";
import { describe, expect, it } from "vitest";

function mod(
  id: string,
  tags: Record<string, string> = {},
  kind: ModuleKind = "source",
): ModuleNode {
  return {
    id,
    file: kind === "source" ? id : null,
    kind,
    tags: new Map(Object.entries(tags)),
  };
}
function edge(from: string, to: string, extra: Partial<Edge> = {}): Edge {
  return {
    from,
    to,
    rawSpecifier: to,
    resolvedPath: to,
    kind: "static",
    ...extra,
  };
}
function graph(mods: ModuleNode[], edges: Edge[]): ProjectGraph {
  return ProjectGraph.create({
    host: { name: "test", version: "0", capabilities: new Set() },
    delivery: "complete",
    modules: new Map(mods.map((m) => [m.id, m])),
    edges: edges,
  });
}

/** The shape a rule sees: one computation over one view. */
function computeOver(g: ProjectGraph) {
  return new GraphComputationCache().get(stronglyConnectedComponents, new GraphQuery(g));
}

describe("GraphComputationCache", () => {
  it("computes once per analysis per view", () => {
    let calls = 0;
    const counting = defineGraphComputation({
      name: "count",
      compute: () => ++calls,
    });
    const cache = new GraphComputationCache();
    const view = new GraphQuery(graph([mod("a")], []));
    expect(cache.get(counting, view)).toBe(1);
    expect(cache.get(counting, view)).toBe(1);
    expect(calls).toBe(1);
  });

  it("computes separately per view, so a scoped rule never gets whole-graph results", () => {
    // The bug this key exists to prevent: `ctx.graph` narrowed and `ctx.compute` silently not.
    let calls = 0;
    const counting = defineGraphComputation({
      name: "count",
      compute: () => ++calls,
    });
    const cache = new GraphComputationCache();
    const whole = new GraphQuery(graph([mod("a"), mod("b")], []));
    const scoped = whole.scoped(new Set(["a"]));
    expect(cache.get(counting, whole)).toBe(1);
    expect(cache.get(counting, scoped)).toBe(2);
    expect(cache.get(counting, scoped)).toBe(2);
    expect(calls).toBe(2);
  });
});

describe("stronglyConnectedComponents", () => {
  it("finds a 3-cycle and singletons", () => {
    const g = graph(
      [mod("a"), mod("b"), mod("c"), mod("d")],
      [edge("a", "b"), edge("b", "c"), edge("c", "a"), edge("c", "d")],
    );
    const sccs = computeOver(g);
    const multi = sccs.filter((s) => s.length > 1);
    expect(multi).toHaveLength(1);
    expect([...multi[0]!].sort()).toEqual(["a", "b", "c"]);
  });
  it("ignores dynamic edges", () => {
    const g = graph([mod("a"), mod("b")], [edge("a", "b"), edge("b", "a", { kind: "dynamic" })]);
    const sccs = computeOver(g);
    expect(sccs.every((s) => s.length === 1)).toBe(true);
  });
  it("handles deep chains without recursion overflow", () => {
    const n = 20000;
    const mods = Array.from({ length: n }, (_, i) => mod(`m${i}`));
    const edges = Array.from({ length: n - 1 }, (_, i) => edge(`m${i}`, `m${i + 1}`));
    const sccs = computeOver(graph(mods, edges));
    expect(sccs).toHaveLength(n);
  });
});
