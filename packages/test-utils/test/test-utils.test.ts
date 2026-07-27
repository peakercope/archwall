import { defineRule } from "@archwall/core";
import { buildFixtureGraph, expectViolations, runRule } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

const flagCross = defineRule({
  meta: { name: "flag-cross", description: "", defaultSeverity: "error" },
  check(ctx) {
    ctx.graph
      .modules({ tag: { layer: "a" } })
      .edgesOut({ toTag: { layer: "b" } })
      .forEach((edge) => ctx.report({ edge, message: "a->b" }));
  },
});

describe("test-utils", () => {
  it("builds graphs from shorthand and runs a rule", async () => {
    const g = buildFixtureGraph({
      modules: [{ id: "x", tags: { layer: "a" } }, { id: "y", tags: { layer: "b" } }, "z"],
      edges: [
        ["x", "y"],
        ["y", "z"],
      ],
    });
    expect(g.modules.size).toBe(3);
    expect(g.host.capabilities.has("complete-graph")).toBe(true);
    const violations = await runRule(flagCross, g);
    expectViolations(violations, [{ rule: "flag-cross", from: "x", to: "y" }]);
  });
  it("expectViolations throws with detail on mismatch", () => {
    expect(() => expectViolations([], [{ rule: "flag-cross" }])).toThrow(/expected 1/i);
  });
  it("runRule respects severity option", async () => {
    const g = buildFixtureGraph({
      modules: [
        { id: "x", tags: { layer: "a" } },
        { id: "y", tags: { layer: "b" } },
      ],
      edges: [["x", "y"]],
    });
    const violations = await runRule(flagCross, g, {}, { severity: "warn" });
    expect(violations[0]!.severity).toBe("warn");
  });
});
