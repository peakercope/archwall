import { dropTypeOnlyEdges } from "@archwall/core";
import { applyProjectBoundary, GraphQuery, prepareGraph } from "@archwall/core/internal";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

/**
 * `Edge.attributes` and the policy transform over it.
 *
 * The interesting behaviour is not "the field exists" — it is the two places where the
 * absent/false distinction decides an answer.
 */

const config = {
  sourceRoot: "/repo",
  repoRoot: "/repo",
  include: ["**"],
  exclude: [],
};

const graphWith = (edges: Parameters<typeof buildFixtureGraph>[0]["edges"]) =>
  buildFixtureGraph({
    modules: ["/repo/a.ts", "/repo/b.ts", "/repo/c.ts"],
    edges,
    capabilities: ["complete-graph", "type-only-edges"],
  });

describe("EdgeFilter.attributes", () => {
  const graph = graphWith([
    { from: "/repo/a.ts", to: "/repo/b.ts", attributes: { typeOnly: true } },
    { from: "/repo/a.ts", to: "/repo/c.ts" },
  ]);
  const q = new GraphQuery(graph);

  it("`true` selects edges carrying the attribute", () => {
    expect(q.edges({ attributes: { typeOnly: true } }).map((e) => e.to)).toEqual(["/repo/b.ts"]);
  });

  it("`false` selects edges where it is ABSENT", () => {
    expect(q.edges({ attributes: { typeOnly: false } }).map((e) => e.to)).toEqual(["/repo/c.ts"]);
  });

  it("an unknown attribute key matches nothing when required", () => {
    expect(q.edges({ attributes: { somethingElse: true } })).toHaveLength(0);
  });

  it("matches a string-valued attribute exactly", () => {
    const q2 = new GraphQuery(
      graphWith([{ from: "/repo/a.ts", to: "/repo/b.ts", attributes: { via: "worker" } }]),
    );
    expect(q2.edges({ attributes: { via: "worker" } })).toHaveLength(1);
    expect(q2.edges({ attributes: { via: "wasm" } })).toHaveLength(0);
  });
});

describe("dropTypeOnlyEdges", () => {
  it("removes only the type-only edges", () => {
    const graph = graphWith([
      { from: "/repo/a.ts", to: "/repo/b.ts", attributes: { typeOnly: true } },
      { from: "/repo/a.ts", to: "/repo/c.ts" },
    ]);
    const result = prepareGraph(graph, config, [dropTypeOnlyEdges()], []);
    expect(result.graph.edges().map((e) => e.to)).toEqual(["/repo/c.ts"]);
    expect(result.diagnostics).toEqual([]);
  });

  it("is a no-op against a host that never reported the attribute", () => {
    const graph = graphWith([
      { from: "/repo/a.ts", to: "/repo/b.ts" },
      { from: "/repo/a.ts", to: "/repo/c.ts" },
    ]);
    const result = prepareGraph(graph, config, [dropTypeOnlyEdges()], []);
    expect(result.graph.edgeCount).toBe(2);
  });

  /**
   * The whole reason this is a transform and not producer behaviour: without it configured,
   * the edges are still there for a layering rule to see.
   */
  it("leaves type-only edges in place when not configured", () => {
    const graph = graphWith([
      { from: "/repo/a.ts", to: "/repo/b.ts", attributes: { typeOnly: true } },
    ]);
    expect(applyProjectBoundary(graph, config).edges()).toHaveLength(1);
  });
});
