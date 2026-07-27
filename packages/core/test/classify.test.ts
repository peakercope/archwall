import type { ModuleKind, ModuleNode, ProjectGraph } from "@archwall/core";
import { applyClassifiers, IR_VERSION } from "@archwall/core";
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
function graph(mods: ModuleNode[]): ProjectGraph {
  return {
    irVersion: IR_VERSION,
    host: { name: "test", version: "0", capabilities: new Set() },
    delivery: "complete",
    modules: new Map(mods.map((m) => [m.id, m])),
    edges: [],
  };
}

const byPrefix = {
  name: "by-prefix",
  classify: (m: { file: string | null }) =>
    m.file?.startsWith("/src/features/") ? { layer: "features" } : null,
};
const override = { name: "override", classify: () => ({ layer: "custom" }) };

describe("applyClassifiers", () => {
  it("tags modules and does not mutate the input graph", () => {
    const g = graph([mod("/src/features/a.ts")]);
    const out = applyClassifiers(g, [byPrefix], { sourceRoot: "/src" });
    expect(out.modules.get("/src/features/a.ts")!.tags.get("layer")).toBe("features");
    expect(g.modules.get("/src/features/a.ts")!.tags.size).toBe(0);
  });
  it("later classifiers override same key", () => {
    const g = graph([mod("/src/features/a.ts")]);
    const out = applyClassifiers(g, [byPrefix, override], {
      sourceRoot: "/src",
    });
    expect(out.modules.get("/src/features/a.ts")!.tags.get("layer")).toBe("custom");
  });
});
