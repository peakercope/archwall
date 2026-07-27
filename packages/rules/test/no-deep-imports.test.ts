import { analyze, configureRule, resolveConfig } from "@archwall/core";
import { noDeepImports } from "@archwall/rules";
import { buildFixtureGraph, expectViolations, runRule } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

describe("no-deep-imports", () => {
  it("reports raw specifiers matching forbidden patterns unless allowed", async () => {
    const g = buildFixtureGraph({
      modules: ["a", "b", "c", "d"],
      edges: [
        { from: "a", to: "b", rawSpecifier: "@/features/auth" },
        { from: "a", to: "c", rawSpecifier: "@/features/auth/model/store" },
        { from: "a", to: "d", rawSpecifier: "./local/deep/thing" },
      ],
    });
    const violations = await runRule(noDeepImports, g, {
      forbiddenSpecifiers: ["@/features/*/**"],
      allowedSpecifiers: ["@/features/*"],
    });
    expectViolations(violations, [
      {
        rule: "no-deep-imports",
        from: "a",
        to: "c",
        messageIncludes: "@/features/auth/model/store",
      },
    ]);
  });

  it("skips LOUDLY on a host that cannot supply raw specifiers", async () => {
    // The silent non-enforcement path this rule used to have. Under Vite dev the module
    // graph carries no specifiers, so `rawSpecifier` falls back to the resolved id, every
    // pattern misses, and the rule reported a clean run. "No deep imports" and "ArchWall
    // could not check for deep imports" must not look the same.
    const g = buildFixtureGraph({
      modules: ["a", "c"],
      // What a specifier-less host actually produces: the resolved id in both fields.
      edges: [{ from: "a", to: "c", rawSpecifier: "c" }],
      capabilities: ["complete-graph", "dynamic-imports"],
    });
    const result = await analyze(
      g,
      resolveConfig({
        rules: [
          configureRule(noDeepImports, {
            forbiddenSpecifiers: ["@/features/*/**"],
          }),
        ],
      }),
    );
    expect(result.violations).toHaveLength(0);
    const skipped = result.diagnostics.filter((d) => d.code === "rule-skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.details!["missingCapabilities"]).toEqual(["raw-specifiers"]);
  });
});
