import { THIRD_PARTY_KINDS } from "@archwall/core";
import { forbiddenDependencies } from "@archwall/rules";
import { buildFixtureGraph, expectViolations, runRule } from "@archwall/test-utils";
import { describe, it } from "vitest";

describe("forbidden-dependencies", () => {
  it("reports edges matching from/to matchers", async () => {
    const g = buildFixtureGraph({
      modules: [
        { id: "d", tags: { domain: "billing" } },
        { id: "u", tags: { domain: "ui" } },
        { id: "lodash", kind: "package", packageName: "lodash" },
      ],
      edges: [
        ["d", "u"],
        ["d", "lodash"],
        ["u", "lodash"],
      ],
    });
    const violations = await runRule(forbiddenDependencies, g, {
      forbid: [
        {
          from: { tag: { domain: "billing" } },
          to: { tag: { domain: "ui" } },
          message: "billing must not touch ui",
        },
        { from: { tag: { domain: "billing" } }, to: { packageName: "lodash" } },
      ],
    });
    expectViolations(violations, [
      {
        rule: "forbidden-dependencies",
        from: "d",
        to: "u",
        messageIncludes: "billing must not touch ui",
      },
      { rule: "forbidden-dependencies", from: "d", to: "lodash" },
    ]);
  });

  it("exempts targets matching `except` — the purity carve-out", async () => {
    const g = buildFixtureGraph({
      modules: [
        { id: "domain", tags: { layer: "domain" } },
        { id: "zod", kind: "package", packageName: "zod" },
        { id: "axios", kind: "package", packageName: "axios" },
      ],
      edges: [
        ["domain", "zod"],
        ["domain", "axios"],
      ],
    });
    const violations = await runRule(forbiddenDependencies, g, {
      forbid: [
        {
          from: { tag: { layer: "domain" } },
          to: { moduleKind: THIRD_PARTY_KINDS },
          except: { packageName: ["zod", "date-fns"] },
        },
      ],
    });
    expectViolations(violations, [{ rule: "forbidden-dependencies", from: "domain", to: "axios" }]);
  });
});
