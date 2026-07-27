import { layerDependencies } from "@archwall/rules";
import { buildFixtureGraph, expectViolations, runRule } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

const layers = ["app", "pages", "widgets", "features", "entities", "shared"];

describe("layer-dependencies", () => {
  it("allows downward, reports upward", async () => {
    const g = buildFixtureGraph({
      modules: [
        { id: "w", tags: { layer: "widgets" } },
        { id: "f", tags: { layer: "features" } },
        { id: "f2", tags: { layer: "features" } },
        { id: "s", tags: { layer: "shared" } },
        { id: "untagged" },
      ],
      edges: [
        ["w", "f"],
        ["f", "w"],
        ["f", "s"],
        ["f", "f2"],
        ["s", "untagged"],
      ],
    });
    const violations = await runRule(layerDependencies, g, { layers });
    expectViolations(violations, [{ rule: "layer-dependencies", from: "f", to: "w" }]);
    expect(violations[0]!.message).toContain("features");
    expect(violations[0]!.message).toContain("widgets");
  });
  it("ignores modules whose layer tag is not in the configured order", async () => {
    const g = buildFixtureGraph({
      modules: [
        { id: "a", tags: { layer: "weird" } },
        { id: "w", tags: { layer: "widgets" } },
      ],
      edges: [
        ["a", "w"],
        ["w", "a"],
      ],
    });
    expect(await runRule(layerDependencies, g, { layers })).toHaveLength(0);
  });
});
