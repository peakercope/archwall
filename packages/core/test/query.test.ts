import type { Edge, ModuleKind, ModuleNode, ProjectGraph } from "@archwall/core";
import { GraphQuery, IR_VERSION, THIRD_PARTY_KINDS } from "@archwall/core";
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

const g = graph(
  [
    mod("/src/features/auth/a.ts", { layer: "features", slice: "auth" }),
    mod("/src/features/cart/c.ts", { layer: "features", slice: "cart" }),
    mod("/src/shared/s.ts", { layer: "shared" }),
    mod("react", {}, "package"),
  ],
  [
    edge("/src/features/auth/a.ts", "/src/features/cart/c.ts"),
    edge("/src/features/auth/a.ts", "/src/shared/s.ts"),
    edge("/src/features/cart/c.ts", "react", { kind: "dynamic" }),
  ],
);
const q = new GraphQuery(g);

describe("GraphQuery", () => {
  it("filters modules by tag (all entries must match)", () => {
    expect(q.modules({ tag: { layer: "features" } }).toArray()).toHaveLength(2);
    expect(
      q
        .modules({ tag: { layer: "features", slice: "auth" } })
        .toArray()
        .map((m) => m.id),
    ).toEqual(["/src/features/auth/a.ts"]);
  });
  it("filters modules by kind", () => {
    expect(
      q
        .modules({ moduleKind: THIRD_PARTY_KINDS })
        .toArray()
        .map((m) => m.id),
    ).toEqual(["react"]);
  });
  it("edgesOut unions selected modules' out-edges with filters", () => {
    const crossing = q.modules({ tag: { layer: "features" } }).edgesOut({ crossing: "slice" });
    expect(crossing).toHaveLength(1);
    expect(crossing[0]!.to).toBe("/src/features/cart/c.ts");
  });
  it("edge filter by toTag and kind", () => {
    expect(q.edges({ toTag: { layer: "shared" } })).toHaveLength(1);
    expect(q.edges({ kind: "dynamic" })).toHaveLength(1);
    expect(q.edges({ toModuleKind: THIRD_PARTY_KINDS })[0]!.to).toBe("react");
  });
  it("edgesOutOf / edgesInto / tagOf / module / moduleCount", () => {
    expect(q.edgesOutOf("/src/features/auth/a.ts")).toHaveLength(2);
    expect(q.edgesInto("/src/shared/s.ts")).toHaveLength(1);
    expect(q.tagOf("/src/shared/s.ts", "layer")).toBe("shared");
    expect(q.module("react")!.kind).toBe("package");
    expect(q.moduleCount()).toBe(4);
  });
});
