import { analyze, configureRule, defineRule, resolveConfig } from "@archwall/core";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

/**
 * Rule scoping is what makes a monorepo expressible in ONE config and ONE pass.
 *
 * Without it, "FSD under apps/web, layered under services/api" needs N tool invocations
 * with N configs — impossible inside a single bundler build, which is the only place the
 * graph exists. Scoping lives on `ConfiguredRule` and is applied by the ENGINE, so every
 * rule that will ever be written inherits it without knowing it exists.
 */
const flagModules = defineRule({
  meta: { name: "flag-modules", description: "", defaultSeverity: "error" },
  check(ctx) {
    ctx.graph.modules().forEach((m) => ctx.report({ module: m.id, message: m.id }));
  },
});

const flagEdges = defineRule({
  meta: { name: "flag-edges", description: "", defaultSeverity: "error" },
  check(ctx) {
    for (const e of ctx.graph.edges()) ctx.report({ edge: e, message: `${e.from} -> ${e.to}` });
  },
});

const graph = () =>
  buildFixtureGraph({
    modules: [
      { id: "/repo/apps/web/a.ts", tags: { area: "web" } },
      { id: "/repo/apps/web/b.ts", tags: { area: "web" } },
      { id: "/repo/services/api/x.ts", tags: { area: "api" } },
      { id: "/repo/services/api/y.ts", tags: { area: "api" } },
    ],
    edges: [
      ["/repo/apps/web/a.ts", "/repo/apps/web/b.ts"],
      ["/repo/apps/web/a.ts", "/repo/services/api/x.ts"],
      ["/repo/services/api/x.ts", "/repo/services/api/y.ts"],
    ],
  });

async function modulesSeenBy(scope?: {
  include?: string[];
  exclude?: string[];
  tag?: Record<string, string>;
}) {
  const result = await analyze(
    graph(),
    resolveConfig(
      {
        rules: [configureRule(flagModules, {}, scope !== undefined ? { scope } : undefined)],
      },
      { cwd: "/repo" },
    ),
  );
  return result.violations.map((v) => v.module).sort();
}

describe("rule scope", () => {
  it("restricts a rule to a subtree, leaving the rest of the graph alone", async () => {
    expect(await modulesSeenBy({ include: ["apps/web/**"] })).toEqual([
      "/repo/apps/web/a.ts",
      "/repo/apps/web/b.ts",
    ]);
  });

  it("restricts a rule by tag", async () => {
    expect(await modulesSeenBy({ tag: { area: "api" } })).toEqual([
      "/repo/services/api/x.ts",
      "/repo/services/api/y.ts",
    ]);
  });

  it("subtracts `exclude` from `include`", async () => {
    expect(await modulesSeenBy({ include: ["apps/**"], exclude: ["**/b.ts"] })).toEqual([
      "/repo/apps/web/a.ts",
    ]);
  });

  it("sees the whole graph when unscoped", async () => {
    expect(await modulesSeenBy()).toHaveLength(4);
  });

  it("lets two instances of one rule police two subtrees differently", async () => {
    // The actual monorepo shape: one config, one pass, two independent policies.
    const result = await analyze(
      graph(),
      resolveConfig(
        {
          rules: [
            configureRule(flagModules, {}, { id: "web", scope: { include: ["apps/web/**"] } }),
            configureRule(flagModules, {}, { id: "api", scope: { include: ["services/api/**"] } }),
          ],
        },
        { cwd: "/repo" },
      ),
    );
    const byId = (id: string) =>
      result.violations
        .filter((v) => v.ruleId === id)
        .map((v) => v.module)
        .sort();
    expect(byId("web")).toEqual(["/repo/apps/web/a.ts", "/repo/apps/web/b.ts"]);
    expect(byId("api")).toEqual(["/repo/services/api/x.ts", "/repo/services/api/y.ts"]);
  });

  it("keeps edges that LEAVE the scope, since that is the interesting finding", async () => {
    // Scope selects which modules the rule is *about*, not what it may look at. An import
    // crossing out of the scope is exactly what a boundary rule exists to catch, so the
    // edge must survive — only edges originating outside the scope are dropped.
    const result = await analyze(
      graph(),
      resolveConfig(
        {
          rules: [configureRule(flagEdges, {}, { scope: { include: ["apps/web/**"] } })],
        },
        { cwd: "/repo" },
      ),
    );
    expect(result.violations.map((v) => v.message).sort()).toEqual([
      "/repo/apps/web/a.ts -> /repo/apps/web/b.ts",
      "/repo/apps/web/a.ts -> /repo/services/api/x.ts",
    ]);
  });

  it("still resolves an out-of-scope import target, so a rule can say what it is", async () => {
    const inspect = defineRule({
      meta: { name: "inspect", description: "", defaultSeverity: "error" },
      check(ctx) {
        for (const e of ctx.graph.edges()) {
          const to = ctx.graph.module(e.to);
          if (to !== undefined) ctx.report({ edge: e, message: `${to.id} is ${to.kind}` });
        }
      },
    });
    const result = await analyze(
      graph(),
      resolveConfig(
        {
          rules: [configureRule(inspect, {}, { scope: { include: ["apps/web/**"] } })],
        },
        { cwd: "/repo" },
      ),
    );
    expect(result.violations.map((v) => v.message)).toContain("/repo/services/api/x.ts is source");
  });
});
