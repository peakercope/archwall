import { publicApi } from "@archwall/rules";
import { buildFixtureGraph, expectViolations, runRule } from "@archwall/test-utils";
import { describe, it } from "vitest";

describe("public-api", () => {
  it("reports cross-scope imports of internal modules", async () => {
    const g = buildFixtureGraph({
      modules: [
        { id: "widget", tags: { layer: "widgets", slice: "header" } },
        {
          id: "authIndex",
          tags: { layer: "features", slice: "auth", visibility: "public" },
        },
        {
          id: "authStore",
          tags: { layer: "features", slice: "auth", visibility: "internal" },
        },
        {
          id: "authUi",
          tags: { layer: "features", slice: "auth", visibility: "internal" },
        },
      ],
      edges: [
        ["widget", "authIndex"],
        ["widget", "authStore"],
        ["authIndex", "authStore"],
        ["authUi", "authStore"],
      ],
    });
    const violations = await runRule(publicApi, g);
    expectViolations(violations, [{ rule: "public-api", from: "widget", to: "authStore" }]);
  });
});
