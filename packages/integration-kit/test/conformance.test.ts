import * as path from "node:path";
import type { Violation } from "@archwall/core";
import { analyze, resolveConfig } from "@archwall/core";
import { assertViolationsMatch, FSD_APP_EXPECTED, GraphBuilder } from "@archwall/integration-kit";
import { fsd } from "@archwall/presets";
import { describe, expect, it } from "vitest";

const v = (rule: string, from: string, to: string): Violation => ({
  ruleName: rule,
  ruleId: rule,
  severity: "error",
  message: "m",
  fingerprint: `aw3:${rule}`,
  locations: [
    {
      type: "edge",
      edge: { from, to, rawSpecifier: to, resolvedPath: to, kind: "static" },
    },
  ],
});

describe("assertViolationsMatch", () => {
  it("passes on same set regardless of order", () => {
    const violations = [v("a", "file:x.ts", "file:y.ts"), v("b", "file:y.ts", "file:z.ts")];
    expect(() =>
      assertViolationsMatch(violations, [
        { rule: "b", from: "file:y.ts", to: "file:z.ts" },
        { rule: "a", from: "file:x.ts", to: "file:y.ts" },
      ]),
    ).not.toThrow();
  });

  it("throws listing expected and actual on mismatch", () => {
    expect(() => assertViolationsMatch([v("a", "file:x.ts", "file:y.ts")], [])).toThrow(
      /a\|file:x\.ts\|file:y\.ts/,
    );
  });
});

describe("FSD fixture app expectations", () => {
  it("FSD_APP_EXPECTED matches an in-memory replica of the fixture graph", async () => {
    // Built through `GraphBuilder`, not by hand: it is the component that assigns identity,
    // so a replica that skipped it would be asserting against ids no producer ever emits.
    const repoRoot = path.resolve(import.meta.dirname, "../fixtures/fsd-app");
    const src = path.join(repoRoot, "src");
    const f = (p: string) => path.join(src, p);
    const builder = new GraphBuilder({
      host: { name: "test", version: "0", capabilities: new Set(["complete-graph"]) },
      repoRoot,
    });
    for (const p of [
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
    ]) {
      builder.addModule({ id: f(p), file: f(p), kind: "source" });
    }
    const link = (from: string, to: string, kind: "static" | "reexport" = "static") =>
      builder.addEdge({ from: f(from), to: f(to), kind });
    link("main.ts", "widgets/header/index.ts");
    link("main.ts", "shared/lib/bad.ts");
    link("main.ts", "features/cart/index.ts");
    link("shared/lib/bad.ts", "widgets/header/index.ts");
    link("entities/user/index.ts", "entities/user/model/user.ts", "reexport");
    link("entities/user/model/user.ts", "shared/lib/format.ts");
    link("features/auth/index.ts", "features/auth/model/store.ts", "reexport");
    link("features/auth/model/store.ts", "entities/user/index.ts");
    link("features/cart/index.ts", "features/cart/model/cart.ts", "reexport");
    link("features/cart/model/cart.ts", "features/auth/model/store.ts");
    link("widgets/header/index.ts", "widgets/header/ui/Header.ts", "reexport");
    link("widgets/header/ui/Header.ts", "features/auth/index.ts");
    link("widgets/header/ui/Header.ts", "shared/lib/format.ts");

    const result = await analyze(
      builder.build(),
      resolveConfig({ sourceRoot: "src", presets: [fsd()] }, { cwd: repoRoot }),
    );
    assertViolationsMatch(result.violations, FSD_APP_EXPECTED);
  });
});

describe("external identity in expectations", () => {
  /**
   * The property the whole scheme exists for: a host that resolved `react` into node_modules
   * and one that left the bare specifier must produce the same graph, with no normalisation
   * step anywhere downstream. See docs/adr/0012-canonical-module-identity.md.
   */
  it("gives a resolved external and an unresolved one the same identity", async () => {
    const repoRoot = "/root";
    const build = (target: { id: string; file: string | null }) => {
      const b = new GraphBuilder({
        host: { name: "test", version: "0", capabilities: new Set(["complete-graph"]) },
        repoRoot,
      });
      b.addModule({ id: "/root/src/domain/rules.ts", file: "/root/src/domain/rules.ts" });
      b.addModule({ ...target, kind: "package", packageName: "react", specifier: "react" });
      b.addEdge({ from: "/root/src/domain/rules.ts", to: target.id, rawSpecifier: "react" });
      return b.build();
    };
    const resolved = build({
      id: "/root/node_modules/react/index.js",
      file: "/root/node_modules/react/index.js",
    });
    const bare = build({ id: "react", file: null });

    for (const g of [resolved, bare]) {
      expect(g.edges().map((e) => `${e.from} -> ${e.to}`)).toEqual([
        "file:src/domain/rules.ts -> pkg:react",
      ]);
    }
  });
});
