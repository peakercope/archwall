import * as path from "node:path";
import type { Violation } from "@archwall/core";
import { analyze, resolveConfig } from "@archwall/core";
import { assertViolationsMatch, FSD_APP_EXPECTED } from "@archwall/integration-kit";
import { fsd } from "@archwall/presets";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

const v = (rule: string, from: string, to: string): Violation => ({
  ruleName: rule,
  ruleId: rule,
  severity: "error",
  message: "m",
  fingerprint: `aw2:${rule}`,
  locations: [
    {
      type: "edge",
      edge: {
        from: `/root/${from}`,
        to: `/root/${to}`,
        rawSpecifier: to,
        resolvedPath: `/root/${to}`,
        kind: "static",
      },
    },
  ],
});

describe("assertViolationsMatch", () => {
  it("passes on same set regardless of order", () => {
    const violations = [v("a", "x.ts", "y.ts"), v("b", "y.ts", "z.ts")];
    expect(() =>
      assertViolationsMatch(violations, "/root", [
        { rule: "b", from: "y.ts", to: "z.ts" },
        { rule: "a", from: "x.ts", to: "y.ts" },
      ]),
    ).not.toThrow();
  });
  it("throws listing expected and actual on mismatch", () => {
    expect(() => assertViolationsMatch([v("a", "x.ts", "y.ts")], "/root", [])).toThrow(
      /a\|x\.ts\|y\.ts/,
    );
  });
});

describe("FSD fixture app expectations", () => {
  it("FSD_APP_EXPECTED matches an in-memory replica of the fixture graph", async () => {
    const root = path.resolve(import.meta.dirname, "../fixtures/fsd-app/src");
    const f = (p: string) => path.join(root, p);
    const g = buildFixtureGraph({
      modules: [
        "main.ts",
        "shared/lib/format.ts",
        "shared/lib/bad.ts",
        "entities/user/index.ts",
        "entities/user/model/user.ts",
        "features/auth/index.ts",
        "features/auth/model/store.ts",
        "features/cart/index.ts",
        "features/cart/model/cart.ts",
        "widgets/header/index.ts",
        "widgets/header/ui/Header.ts",
      ].map(f),
      edges: [
        [f("main.ts"), f("widgets/header/index.ts")],
        [f("main.ts"), f("shared/lib/bad.ts")],
        [f("main.ts"), f("features/cart/index.ts")],
        [f("shared/lib/bad.ts"), f("widgets/header/index.ts")],
        {
          from: f("entities/user/index.ts"),
          to: f("entities/user/model/user.ts"),
          kind: "reexport",
        },
        [f("entities/user/model/user.ts"), f("shared/lib/format.ts")],
        {
          from: f("features/auth/index.ts"),
          to: f("features/auth/model/store.ts"),
          kind: "reexport",
        },
        [f("features/auth/model/store.ts"), f("entities/user/index.ts")],
        {
          from: f("features/cart/index.ts"),
          to: f("features/cart/model/cart.ts"),
          kind: "reexport",
        },
        [f("features/cart/model/cart.ts"), f("features/auth/model/store.ts")],
        {
          from: f("widgets/header/index.ts"),
          to: f("widgets/header/ui/Header.ts"),
          kind: "reexport",
        },
        [f("widgets/header/ui/Header.ts"), f("features/auth/index.ts")],
        [f("widgets/header/ui/Header.ts"), f("shared/lib/format.ts")],
      ],
    });
    const result = await analyze(
      g,
      resolveConfig({ sourceRoot: ".", presets: [fsd()] }, { cwd: root }),
    );
    assertViolationsMatch(result.violations, root, FSD_APP_EXPECTED);
  });
});

describe("external identity in expectations", () => {
  it("compares an external target by package name, not by its path in node_modules", () => {
    const violation: Violation = {
      ruleName: "forbidden-dependencies",
      ruleId: "forbidden-dependencies",
      severity: "error",
      message: "m",
      fingerprint: "aw2:x",
      locations: [
        {
          type: "edge",
          edge: {
            from: "/root/domain/rules.ts",
            to: "/root/../node_modules/react/index.js",
            rawSpecifier: "react",
            resolvedPath: "/root/../node_modules/react/index.js",
            kind: "static",
          },
        },
      ],
    };
    expect(() =>
      assertViolationsMatch([violation], "/root", [
        {
          rule: "forbidden-dependencies",
          from: "domain/rules.ts",
          to: "react",
        },
      ]),
    ).not.toThrow();
  });
});
