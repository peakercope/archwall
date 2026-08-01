import { GraphQuery } from "@archwall/core/internal";

import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

/**
 * "domain must not TRANSITIVELY reach infrastructure" is a mainstream architectural
 * requirement, and there were no path queries at all — so every rule needing one had to
 * hand-roll a BFS in userland, over the very structure that had to become private.
 */
const q = new GraphQuery(
  buildFixtureGraph({
    modules: ["/p/app.ts", "/p/domain.ts", "/p/ports.ts", "/p/infra.ts", "/p/lonely.ts"],
    edges: [
      ["/p/app.ts", "/p/domain.ts"],
      ["/p/domain.ts", "/p/ports.ts"],
      ["/p/ports.ts", "/p/infra.ts"],
      { from: "/p/app.ts", to: "/p/infra.ts", kind: "dynamic" },
    ],
  }),
);

describe("reachability", () => {
  it("finds transitively reachable modules, not just direct dependencies", () => {
    expect([...q.reachableFrom("/p/domain.ts")].sort()).toEqual(["/p/infra.ts", "/p/ports.ts"]);
    expect([...q.reachableFrom("/p/lonely.ts")]).toEqual([]);
  });

  it("finds everything that reaches a module", () => {
    expect([...q.reaching("/p/infra.ts")].sort()).toEqual([
      "/p/app.ts",
      "/p/domain.ts",
      "/p/ports.ts",
    ]);
  });

  it("honours an edge filter, so a dynamic import can be excluded from the walk", () => {
    // The same reason `no-cycles` ignores dynamic edges: a dynamic import is a deliberate
    // decoupling point, and whether it counts is the rule author's call.
    const staticOnly = q.reachableFrom("/p/app.ts", { kind: "static" });
    expect([...staticOnly].sort()).toEqual(["/p/domain.ts", "/p/infra.ts", "/p/ports.ts"]);
  });

  it("returns the SHORTEST path, which is the evidence a violation should cite", () => {
    expect(q.pathBetween("/p/app.ts", "/p/infra.ts", { kind: "static" })).toEqual([
      "/p/app.ts",
      "/p/domain.ts",
      "/p/ports.ts",
      "/p/infra.ts",
    ]);
    // With the dynamic edge allowed, the one-hop route wins.
    expect(q.pathBetween("/p/app.ts", "/p/infra.ts")).toEqual(["/p/app.ts", "/p/infra.ts"]);
  });

  it("returns null when there is no path, and the trivial path to itself", () => {
    expect(q.pathBetween("/p/infra.ts", "/p/app.ts")).toBeNull();
    expect(q.pathBetween("/p/app.ts", "/p/app.ts")).toEqual(["/p/app.ts"]);
  });

  it("terminates on cycles", () => {
    const cyclic = new GraphQuery(
      buildFixtureGraph({
        modules: ["a", "b"],
        edges: [
          ["a", "b"],
          ["b", "a"],
        ],
      }),
    );
    expect([...cyclic.reachableFrom("a")].sort()).toEqual(["a", "b"]);
  });
});

describe("ModuleSelection", () => {
  it("is iterable, sized, filterable, and knows its in-edges", () => {
    // It used to be three methods used by exactly one rule — an abstraction half-built,
    // which leaves a third-party rule needing `edgesIn` no option but to abandon it.
    const all = q.modules();
    expect(all.size).toBe(5);
    expect(all.isEmpty()).toBe(false);
    expect([...all].length).toBe(5);

    const narrowed = all.filter((m) => m.id.endsWith("infra.ts"));
    expect(narrowed.ids()).toEqual(["/p/infra.ts"]);
    expect(
      narrowed
        .edgesIn()
        .map((e) => e.from)
        .sort(),
    ).toEqual(["/p/app.ts", "/p/ports.ts"]);
    expect(narrowed.edgesOut()).toEqual([]);
  });
});
