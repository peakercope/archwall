import type { Edge, EdgeFilter } from "@archwall/core";
import { analyze, configureRule, defineRule, primaryEdge, resolveConfig } from "@archwall/core";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

/**
 * Rules declare what they want to look at; the ENGINE owns the traversal.
 *
 * That is what lets one filtered slice of the graph be evaluated once and shared by every
 * rule that asked for it, instead of each rule independently pulling a whole-graph
 * collection — which was O(rules × graph) by construction and left the engine unable to
 * attribute work to rules at all.
 */
const graph = () =>
  buildFixtureGraph({
    modules: [
      { id: "/p/app/a.ts", tags: { layer: "app" } },
      { id: "/p/domain/d.ts", tags: { layer: "domain" } },
      { id: "/p/domain/e.ts", tags: { layer: "domain" } },
      { id: "react", kind: "package", packageName: "react" },
    ],
    edges: [
      ["/p/app/a.ts", "/p/domain/d.ts"],
      ["/p/domain/d.ts", "/p/domain/e.ts"],
      ["/p/domain/d.ts", "react"],
    ],
  });

function edgeRule(name: string, filter?: EdgeFilter, seen?: Edge[]) {
  return defineRule({
    meta: { name, description: "", defaultSeverity: "error" },
    visits: {
      edges: {
        ...(filter !== undefined ? { filter: () => filter } : {}),
        visit(e, ctx) {
          seen?.push(e);
          ctx.report({ edge: e, message: `${e.from} -> ${e.to}` });
        },
      },
    },
  });
}

describe("rule visitors", () => {
  it("visits every edge when no filter narrows the slice", async () => {
    const result = await analyze(
      graph(),
      resolveConfig({ rules: [configureRule(edgeRule("all"))] }, { cwd: "/p" }),
    );
    expect(result.violations).toHaveLength(3);
  });

  it("applies the declared filter, so a rule never sees what it did not ask for", async () => {
    const result = await analyze(
      graph(),
      resolveConfig(
        { rules: [configureRule(edgeRule("crossing", { crossing: "layer" }))] },
        { cwd: "/p" },
      ),
    );
    expect(result.violations.map((v) => primaryEdge(v)!.to)).toEqual(["/p/domain/d.ts"]);
  });

  it("evaluates one slice once and shares it across rules that want the same one", async () => {
    // The point of declaring interest. Both rules ask for `crossing: layer`; the engine
    // resolves that slice a single time, and both see exactly it.
    const a: Edge[] = [];
    const b: Edge[] = [];
    const result = await analyze(
      graph(),
      resolveConfig(
        {
          rules: [
            configureRule(edgeRule("a", { crossing: "layer" }, a)),
            configureRule(edgeRule("b", { crossing: "layer" }, b)),
          ],
        },
        { cwd: "/p" },
      ),
    );
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    // Same Edge objects, because the slice was materialized once.
    expect(a[0]).toBe(b[0]);
    expect(result.violations).toHaveLength(2);
  });

  it("visits modules with a module filter", async () => {
    const packages = defineRule({
      meta: { name: "packages", description: "", defaultSeverity: "error" },
      visits: {
        modules: {
          filter: () => ({ moduleKind: "package" }),
          visit(m, ctx) {
            ctx.report({ module: m.id, message: m.id });
          },
        },
      },
    });
    const result = await analyze(
      graph(),
      resolveConfig({ rules: [configureRule(packages)] }, { cwd: "/p" }),
    );
    expect(result.violations.map((v) => v.message)).toEqual(["react"]);
  });

  it("isolates a throwing visitor rule without disturbing the others in its slice", async () => {
    const broken = defineRule({
      meta: { name: "broken", description: "", defaultSeverity: "error" },
      visits: {
        edges: {
          visit() {
            throw new Error("rule bug");
          },
        },
      },
    });
    const result = await analyze(
      graph(),
      resolveConfig(
        { rules: [configureRule(broken), configureRule(edgeRule("healthy"))] },
        { cwd: "/p" },
      ),
    );
    expect(result.diagnostics.map((d) => d.code)).toContain("rule-failed");
    expect(result.rules.find((r) => r.id === "broken")?.status).toBe("failed");
    // The healthy rule kept every one of its results.
    expect(result.violations).toHaveLength(3);
    expect(result.rules.find((r) => r.id === "healthy")?.violations).toBe(3);
  });

  it("honours a rule scope in a visitor, without the rule knowing scopes exist", async () => {
    const result = await analyze(
      graph(),
      resolveConfig(
        {
          rules: [configureRule(edgeRule("scoped"), {}, { scope: { include: ["domain/**"] } })],
        },
        { cwd: "/p" },
      ),
    );
    // Only edges leaving the scope's modules.
    expect(result.violations.map((v) => primaryEdge(v)!.from)).toEqual([
      "/p/domain/d.ts",
      "/p/domain/d.ts",
    ]);
  });

  it("reports a rule that declares neither visits nor check, rather than silently passing", async () => {
    const inert = defineRule({
      meta: { name: "inert", description: "", defaultSeverity: "error" },
    });
    const result = await analyze(
      graph(),
      resolveConfig({ rules: [configureRule(inert)] }, { cwd: "/p" }),
    );
    const d = result.diagnostics.find((x) => x.code === "invalid-config");
    expect(d?.message).toMatch(/declares neither `visits` nor `check`/);
  });

  it("lets a rule use both a visitor and check", async () => {
    const both = defineRule({
      meta: { name: "both", description: "", defaultSeverity: "error" },
      visits: {
        edges: {
          filter: () => ({ crossing: "layer" }),
          visit(e, ctx) {
            ctx.report({ edge: e, message: "visited" });
          },
        },
      },
      check(ctx) {
        ctx.report({ message: `checked ${ctx.graph.moduleCount()}` });
      },
    });
    const result = await analyze(
      graph(),
      resolveConfig({ rules: [configureRule(both)] }, { cwd: "/p" }),
    );
    expect(result.violations.map((v) => v.message).sort()).toEqual(["checked 4", "visited"]);
    expect(result.rules[0]!.violations).toBe(2);
  });
});
