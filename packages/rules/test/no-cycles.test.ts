import { noCycles } from "@archwall/rules";
import { buildFixtureGraph, runRule } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

describe("no-cycles", () => {
  it("reports one violation per cyclic component", async () => {
    const g = buildFixtureGraph({
      modules: ["a", "b", "c", "d", "e"],
      edges: [
        ["a", "b"],
        ["b", "a"],
        ["c", "d"],
        ["d", "e"],
        ["e", "c"],
      ],
    });
    const violations = await runRule(noCycles, g);
    expect(violations).toHaveLength(2);
    expect(violations[0]!.ruleName).toBe("no-cycles");
  });
  it("does not report dynamic-import cycles or acyclic graphs", async () => {
    const g = buildFixtureGraph({
      modules: ["a", "b"],
      edges: [["a", "b"], { from: "b", to: "a", kind: "dynamic" }],
    });
    expect(await runRule(noCycles, g)).toHaveLength(0);
  });
  it("reports self-loops", async () => {
    const g = buildFixtureGraph({ modules: ["a"], edges: [["a", "a"]] });
    expect(await runRule(noCycles, g)).toHaveLength(1);
  });
  it("ignores cycles that live entirely inside dependencies", async () => {
    // Bundling a CJS package routinely produces these; the user cannot act on them.
    const g = buildFixtureGraph({
      modules: [
        { id: "react", kind: "package", packageName: "react" },
        { id: "react/cjs", kind: "package", packageName: "react" },
      ],
      edges: [
        ["react", "react/cjs"],
        ["react/cjs", "react"],
        ["react", "react"],
      ],
    });
    expect(await runRule(noCycles, g)).toHaveLength(0);
  });
  it("still reports a cycle that passes through the project", async () => {
    const g = buildFixtureGraph({
      modules: ["a", { id: "pkg", kind: "package", packageName: "pkg" }],
      edges: [
        ["a", "pkg"],
        ["pkg", "a"],
      ],
    });
    expect(await runRule(noCycles, g)).toHaveLength(1);
  });
  it("reports a cycle spanning two workspace packages", async () => {
    // The most valuable cycle there is to report, and it used to be silently dropped:
    // the skip test was `external`, defined as `kind !== "source"`, so a sibling package
    // in your own monorepo counted as a third-party dependency you cannot fix.
    const g = buildFixtureGraph({
      modules: [
        {
          id: "/repo/packages/app/src/a.ts",
          kind: "workspace",
          workspace: "@co/app",
        },
        {
          id: "/repo/packages/lib/src/b.ts",
          kind: "workspace",
          workspace: "@co/lib",
        },
      ],
      edges: [
        ["/repo/packages/app/src/a.ts", "/repo/packages/lib/src/b.ts"],
        ["/repo/packages/lib/src/b.ts", "/repo/packages/app/src/a.ts"],
      ],
    });
    expect(await runRule(noCycles, g)).toHaveLength(1);
  });

  it("still ignores a cycle among modules the config excluded", async () => {
    // `excluded` is your own file, but you asked for it to be left out of the analysis.
    const g = buildFixtureGraph({
      modules: [
        { id: "/p/x.test.ts", kind: "excluded" },
        { id: "/p/y.test.ts", kind: "excluded" },
      ],
      edges: [
        ["/p/x.test.ts", "/p/y.test.ts"],
        ["/p/y.test.ts", "/p/x.test.ts"],
      ],
    });
    expect(await runRule(noCycles, g)).toHaveLength(0);
  });

  it("truncates long cycle messages", async () => {
    const ids = ["m1", "m2", "m3", "m4"];
    const g = buildFixtureGraph({
      modules: ids,
      edges: ids.map((id, i) => [id, ids[(i + 1) % ids.length]!] as [string, string]),
    });
    const violations = await runRule(noCycles, g, { maxCycleLength: 2 });
    expect(violations[0]!.message).toContain("…");
  });
});

describe("no-cycles determinism", () => {
  it("anchors and lists a cycle identically regardless of module insertion order", async () => {
    const edges: [string, string][] = [
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
    ];
    const forward = buildFixtureGraph({ modules: ["a", "b", "c"], edges });
    const reversed = buildFixtureGraph({ modules: ["c", "b", "a"], edges });
    const [f] = await runRule(noCycles, forward);
    const [r] = await runRule(noCycles, reversed);
    // Hosts iterate modules in different orders; the reported cycle must not depend on it.
    expect(f!.module).toBe(r!.module);
    expect(f!.message).toBe(r!.message);
  });
});
