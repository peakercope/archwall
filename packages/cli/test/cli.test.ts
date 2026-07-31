import * as path from "node:path";
import { buildGraphFromFilesystem, check, cliHost, offsetToLineCol } from "@archwall/cli";
import { resolveConfig } from "@archwall/core";
import { assertViolationsMatch, FSD_APP_EXPECTED } from "@archwall/integration-kit";
import { describe, expect, it } from "vitest";

const fixtureDir = path.resolve(import.meta.dirname, "../../integration-kit/fixtures/fsd-app");
const srcRoot = path.join(fixtureDir, "src");

describe("offsetToLineCol", () => {
  it("converts offsets to 1-based line / 0-based column", () => {
    expect(offsetToLineCol("ab\ncd", 0)).toEqual({ line: 1, column: 0 });
    expect(offsetToLineCol("ab\ncd", 3)).toEqual({ line: 2, column: 0 });
    expect(offsetToLineCol("ab\ncd", 4)).toEqual({ line: 2, column: 1 });
  });
});

describe("buildGraphFromFilesystem", () => {
  it("resolves tsconfig path aliases and records raw specifiers, locs, reexports", async () => {
    const config = resolveConfig({ sourceRoot: "src" }, { cwd: fixtureDir });
    const g = await buildGraphFromFilesystem(config, cliHost());
    // Canonical ids, repo-root relative — `srcRoot` is only still needed for `loc.file`, which is a real filesystem path.
    const deep = g
      .edges()
      .find(
        (e) =>
          e.from === "file:src/features/cart/model/cart.ts" &&
          e.to === "file:src/features/auth/model/store.ts",
      );
    expect(deep).toBeDefined();
    expect(deep?.rawSpecifier).toBe("@/features/auth/model/store");
    expect(deep?.loc?.line).toBe(1);
    expect(deep?.loc?.file).toBe(path.join(srcRoot, "features/cart/model/cart.ts"));
    const reexport = g.edges().find((e) => e.from === "file:src/features/auth/index.ts");
    expect(reexport?.kind).toBe("reexport");
    expect(g.delivery).toBe("complete");
  });
});

describe("check", () => {
  it("discovers the fixture config and reports the seeded violations", async () => {
    const { result, failed } = await check({ cwd: fixtureDir });
    expect(failed).toBe(true);
    assertViolationsMatch(result.violations, FSD_APP_EXPECTED);
  });
  it("honors inline failOn override", async () => {
    const { failed } = await check({
      cwd: fixtureDir,
      config: { sourceRoot: "src", failOn: "never", reporters: [] },
    });
    expect(failed).toBe(false);
  });
});
