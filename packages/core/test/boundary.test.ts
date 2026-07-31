import type { ModuleKind, ProjectGraph } from "@archwall/core";
import { analyze, configureRule, defineRule, resolveConfig } from "@archwall/core";
import { applyProjectBoundary } from "@archwall/core/internal";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

const ROOT = "/proj";

function graph(files: { id: string; kind?: ModuleKind }[]): ProjectGraph {
  return buildFixtureGraph({
    modules: files.map((f) => ({
      id: f.id,
      file: f.id,
      ...(f.kind ? { kind: f.kind } : {}),
    })),
  });
}

function kinds(g: ProjectGraph): Record<string, ModuleKind> {
  return Object.fromEntries([...g.modules()].map((m) => [m.id, m.kind]));
}

const bound = (g: ProjectGraph, include: string[], exclude: string[] = []) =>
  applyProjectBoundary(g, { sourceRoot: ROOT, include, exclude });

describe("project boundary", () => {
  it("keeps source modules matching include", () => {
    const g = bound(graph([{ id: "/proj/src/a.ts" }]), ["**"]);
    expect(kinds(g)["/proj/src/a.ts"]).toBe("source");
  });

  it("re-kinds excluded modules rather than deleting them", () => {
    const g = graph([{ id: "/proj/src/a.ts" }, { id: "/proj/src/a.test.ts" }]);
    const out = bound(g, ["**"], ["**/*.test.*"]);
    // Still present: an edge INTO an excluded file is a real fact about the graph, and
    // deleting the node would silently change its shape (cycles through it would vanish).
    expect(out.moduleCount).toBe(2);
    expect(kinds(out)["/proj/src/a.test.ts"]).toBe("excluded");
  });

  it("excludes source outside the root", () => {
    const g = bound(graph([{ id: "/elsewhere/a.ts" }]), ["**"]);
    expect(kinds(g)["/elsewhere/a.ts"]).toBe("excluded");
  });

  it("never re-tests non-source kinds against include", () => {
    // Applying an include glob to dependencies would reclassify every one of them as
    // excluded, since none of them sit under the project root.
    const g = graph([
      { id: "/proj/node_modules/react/index.js", kind: "package" },
      { id: "node:fs", kind: "builtin" },
      { id: "\0virtual:x", kind: "virtual" },
    ]);
    const out = bound(g, ["src/**"]);
    expect(kinds(out)).toEqual({
      "/proj/node_modules/react/index.js": "package",
      "node:fs": "builtin",
      "\0virtual:x": "virtual",
    });
  });

  it("narrows to include, so files outside it stop being analysed", () => {
    const g = graph([{ id: "/proj/src/a.ts" }, { id: "/proj/other/b.ts" }]);
    const out = bound(g, ["src/**"]);
    expect(kinds(out)).toEqual({
      "/proj/src/a.ts": "source",
      "/proj/other/b.ts": "excluded",
    });
  });
});

describe("classification audit", () => {
  const noop = defineRule({
    meta: { name: "noop", description: "", defaultSeverity: "error" },
    check() {},
  });

  it("warns when nothing was classified, so silence is never mistaken for cleanliness", async () => {
    const g = buildFixtureGraph({
      modules: [{ id: "/proj/src/a.ts", file: "/proj/src/a.ts" }],
    });
    const result = await analyze(
      g,
      resolveConfig({ rules: [configureRule(noop)] }, { cwd: "/proj" }),
    );
    expect(result.diagnostics.map((d) => d.code)).toContain("no-modules-classified");
  });

  it("stays quiet once at least one module is classified", async () => {
    const g = buildFixtureGraph({
      modules: [
        {
          id: "/proj/src/a.ts",
          file: "/proj/src/a.ts",
          tags: { layer: "app" },
        },
      ],
    });
    const result = await analyze(
      g,
      resolveConfig({ rules: [configureRule(noop)] }, { cwd: "/proj" }),
    );
    expect(result.diagnostics).toEqual([]);
  });
});
