import { prepareGraph } from "@archwall/core";
import { dropSelfEdges, GraphBuilder } from "@archwall/integration-kit";
import type { DevModuleLike } from "@archwall/vite";
import { addDevModules } from "@archwall/vite";
import { describe, expect, it } from "vitest";

const host = { name: "vite", version: "test", capabilities: new Set<never>() };

describe("addDevModules", () => {
  it("builds a progressive graph from dev module-graph shapes", () => {
    const b: DevModuleLike = {
      id: "/b.ts",
      file: "/b.ts",
      importedModules: [],
    };
    const a: DevModuleLike = {
      id: "/a.ts",
      file: "/a.ts",
      importedModules: [b],
    };
    const anon: DevModuleLike = { id: null, file: null, importedModules: [] };
    const builder = new GraphBuilder({ host, repoRoot: "/", delivery: "progressive" });
    addDevModules(builder, [a, b, anon]);
    const g = builder.build();
    expect(g.delivery).toBe("progressive");
    expect(g.moduleCount).toBe(2);
    expect(g.edges()).toEqual([
      {
        from: "file:a.ts",
        to: "file:b.ts",
        rawSpecifier: "file:b.ts",
        resolvedPath: "file:b.ts",
        kind: "static",
      },
    ]);
  });

  it("leaves HMR self-edges for the shared transform to drop, rather than deciding locally", () => {
    // React Fast Refresh makes every transformed component module import itself. That is a
    // semantic policy, not an extraction detail, so it lives in `dropSelfEdges()` — which
    // this adapter opts into — instead of being reimplemented by every host with HMR.
    const a: DevModuleLike = {
      id: "/a.tsx",
      file: "/a.tsx",
      importedModules: [],
    };
    a.importedModules = [a];
    const builder = new GraphBuilder({ host, repoRoot: "/", delivery: "progressive" });
    addDevModules(builder, [a]);

    const raw = builder.build();
    expect(raw.edges()).toHaveLength(1);
    const dropped = prepareGraph(
      raw,
      { sourceRoot: "/", repoRoot: "/", include: ["**"], exclude: [] },
      [dropSelfEdges()],
      [],
    ).graph;
    expect(dropped.edges()).toEqual([]);
  });
});
