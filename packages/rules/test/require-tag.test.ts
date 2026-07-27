import { requireTag } from "@archwall/rules";
import { buildFixtureGraph, runRule } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

const graph = buildFixtureGraph({
  modules: [
    {
      id: "/proj/src/domain/user.ts",
      file: "/proj/src/domain/user.ts",
      tags: { layer: "domain" },
    },
    { id: "/proj/src/vendor/hack.ts", file: "/proj/src/vendor/hack.ts" },
    { id: "/proj/scripts/build.ts", file: "/proj/scripts/build.ts" },
    { id: "react", kind: "package" },
  ],
  edges: [],
});

describe("require-tag", () => {
  it("reports files inside `within` that carry no tag", async () => {
    const v = await runRule(
      requireTag,
      graph,
      { tag: "layer", within: ["src/**"] },
      { repoRoot: "/proj" },
    );
    expect(v.map((x) => x.module)).toEqual(["/proj/src/vendor/hack.ts"]);
    expect(v[0]!.message).toContain("src/vendor/hack.ts");
  });

  it("ignores files outside `within`", async () => {
    const v = await runRule(
      requireTag,
      graph,
      { tag: "layer", within: ["src/domain/**"] },
      { repoRoot: "/proj" },
    );
    expect(v).toHaveLength(0);
  });

  it("defaults to the whole project and never reports externals", async () => {
    const v = await runRule(requireTag, graph, { tag: "layer" }, { repoRoot: "/proj" });
    expect(v.map((x) => x.module).sort()).toEqual([
      "/proj/scripts/build.ts",
      "/proj/src/vendor/hack.ts",
    ]);
  });
});
