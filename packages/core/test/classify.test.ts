import type { Classifier, ModuleKind, ProjectGraph } from "@archwall/core";
import { prepareGraph } from "@archwall/core/internal";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

const CONFIG = {
  sourceRoot: "/src",
  repoRoot: "/",
  include: ["**"],
  exclude: [],
};

function graph(mods: { id: string; kind?: ModuleKind }[]): ProjectGraph {
  return buildFixtureGraph({
    modules: mods.map((m) => ({ id: m.id, file: m.id, ...(m.kind ? { kind: m.kind } : {}) })),
  });
}

const classify = (g: ProjectGraph, classifiers: Classifier[]) =>
  prepareGraph(g, CONFIG, [], classifiers).graph;

const byPrefix: Classifier = {
  name: "by-prefix",
  classify: (m) => (m.file?.startsWith("/src/features/") ? { layer: "features" } : null),
};
const override: Classifier = { name: "override", classify: () => ({ layer: "custom" }) };

describe("classification", () => {
  it("tags modules and does not mutate the input graph", () => {
    const g = graph([{ id: "/src/features/a.ts" }]);
    const out = classify(g, [byPrefix]);
    expect(out.module("/src/features/a.ts")!.tags.get("layer")).toBe("features");
    expect(g.module("/src/features/a.ts")!.tags.size).toBe(0);
  });

  it("later classifiers override the same key", () => {
    const g = graph([{ id: "/src/features/a.ts" }]);
    const out = classify(g, [byPrefix, override]);
    expect(out.module("/src/features/a.ts")!.tags.get("layer")).toBe("custom");
  });

  it("offers every module to every classifier, including packages", () => {
    const g = graph([{ id: "/src/a.ts" }, { id: "/nm/react.js", kind: "package" }]);
    const out = classify(g, [override]);
    expect(out.module("/nm/react.js")!.tags.get("layer")).toBe("custom");
  });

  it("gives classifiers a source-root-relative path, so they need no path plumbing", () => {
    const seen: (string | null)[] = [];
    const recorder: Classifier = {
      name: "recorder",
      classify: (m, ctx) => {
        if (m.file) seen.push(ctx.relative(m.file));
        return null;
      },
    };
    classify(graph([{ id: "/src/features/a.ts" }, { id: "/elsewhere/b.ts" }]), [recorder]);
    expect(seen).toContain("features/a.ts");
    // Outside the source root has no position in it, and says so rather than emitting `../`.
    expect(seen).toContain(null);
  });
});
