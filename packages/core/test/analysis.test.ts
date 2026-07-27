import type { Edge, ModuleKind, ModuleNode, ProjectGraph } from "@archwall/core";
import {
  defineGraphComputation,
  GraphComputationCache,
  GraphQuery,
  IR_VERSION,
  stronglyConnectedComponents,
} from "@archwall/core";
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
  return {
    irVersion: IR_VERSION,
    host: { name: "test", version: "0", capabilities: new Set() },
    delivery: "complete",
    modules: new Map(mods.map((m) => [m.id, m])),
    edges,
  };
}

describe("GraphComputationCache", () => {
  it("computes once per analysis per cache", () => {
    let calls = 0;
    const counting = defineGraphComputation({
      name: "count",
      compute: () => ++calls,
    });
    const cache = new GraphComputationCache(new GraphQuery(graph([mod("a")], [])));
    expect(cache.get(counting)).toBe(1);
    expect(cache.get(counting)).toBe(1);
    expect(calls).toBe(1);
  });
});

describe("stronglyConnectedComponents", () => {
  it("finds a 3-cycle and singletons", () => {
    const g = graph(
      [mod("a"), mod("b"), mod("c"), mod("d")],
      [edge("a", "b"), edge("b", "c"), edge("c", "a"), edge("c", "d")],
    );
    const sccs = new GraphComputationCache(new GraphQuery(g)).get(stronglyConnectedComponents);
    const multi = sccs.filter((s) => s.length > 1);
    expect(multi).toHaveLength(1);
    expect([...multi[0]!].sort()).toEqual(["a", "b", "c"]);
  });
  it("ignores dynamic edges", () => {
    const g = graph([mod("a"), mod("b")], [edge("a", "b"), edge("b", "a", { kind: "dynamic" })]);
    const sccs = new GraphComputationCache(new GraphQuery(g)).get(stronglyConnectedComponents);
    expect(sccs.every((s) => s.length === 1)).toBe(true);
  });
  it("handles deep chains without recursion overflow", () => {
    const n = 20000;
    const mods = Array.from({ length: n }, (_, i) => mod(`m${i}`));
    const edges = Array.from({ length: n - 1 }, (_, i) => edge(`m${i}`, `m${i + 1}`));
    const sccs = new GraphComputationCache(new GraphQuery(graph(mods, edges))).get(
      stronglyConnectedComponents,
    );
    expect(sccs).toHaveLength(n);
  });
});
