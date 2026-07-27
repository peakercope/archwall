import { featureIsolation } from "@archwall/rules";
import { buildFixtureGraph, expectViolations, runRule } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

describe("feature-isolation", () => {
  const g = buildFixtureGraph({
    modules: [
      { id: "auth", tags: { layer: "features", slice: "auth" } },
      { id: "cart", tags: { layer: "features", slice: "cart" } },
      { id: "cart2", tags: { layer: "features", slice: "cart" } },
      { id: "authEntity", tags: { layer: "entities", slice: "auth" } },
    ],
    edges: [
      ["auth", "cart"],
      ["cart", "cart2"],
      ["auth", "authEntity"],
    ],
  });
  it("reports cross-slice imports within a layer only", async () => {
    const violations = await runRule(featureIsolation, g);
    expectViolations(violations, [{ rule: "feature-isolation", from: "auth", to: "cart" }]);
  });
  it("restricts to given layers when configured", async () => {
    expect(await runRule(featureIsolation, g, { layers: ["entities"] })).toHaveLength(0);
  });
});
