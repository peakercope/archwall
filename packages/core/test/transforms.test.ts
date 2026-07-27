import {
  analyze,
  configureRule,
  defineRule,
  defineTransform,
  dropSelfEdges,
  resolveConfig,
} from "@archwall/core";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

/**
 * The pipeline is `boundary → transform → classify → check`.
 *
 * Before the transform slot existed there was nowhere for a third party — or the planned
 * TypeScript type-edge enricher — to ADD edges or module metadata, which made "an additive
 * capability, not an IR redesign" untrue in practice.
 */
const countEdges = defineRule({
  meta: { name: "count-edges", description: "", defaultSeverity: "error" },
  check(ctx) {
    for (const e of ctx.graph.edges()) ctx.report({ edge: e, message: `${e.from}->${e.to}` });
  },
});

const graph = () =>
  buildFixtureGraph({
    modules: ["/p/a.ts", "/p/b.ts"],
    edges: [["/p/a.ts", "/p/b.ts"]],
  });

describe("graph transforms", () => {
  it("can add edges, and the additions reach rules", async () => {
    const addBackEdge = defineTransform({
      name: "add-back-edge",
      transform: (g) => ({
        ...g,
        edges: [
          ...g.edges,
          {
            from: "/p/b.ts",
            to: "/p/a.ts",
            rawSpecifier: "./a",
            resolvedPath: "/p/a.ts",
            kind: "type",
          },
        ],
      }),
    });
    const result = await analyze(
      graph(),
      resolveConfig(
        { transforms: [addBackEdge], rules: [configureRule(countEdges)] },
        { cwd: "/p" },
      ),
    );
    expect(result.violations.map((v) => v.message).sort()).toEqual([
      "/p/a.ts->/p/b.ts",
      "/p/b.ts->/p/a.ts",
    ]);
  });

  it("runs BEFORE classification, so what it adds gets tagged too", async () => {
    const addModule = defineTransform({
      name: "add-module",
      transform: (g) => {
        const modules = new Map(g.modules);
        modules.set("/p/c.ts", {
          id: "/p/c.ts",
          file: "/p/c.ts",
          kind: "source",
          tags: new Map(),
        });
        return { ...g, modules };
      },
    });
    const seen: string[] = [];
    const readTags = defineRule({
      meta: { name: "read-tags", description: "", defaultSeverity: "error" },
      check(ctx) {
        ctx.graph.modules().forEach((m) => {
          if (m.tags.get("marked") === "yes") seen.push(m.id);
        });
      },
    });
    await analyze(
      graph(),
      resolveConfig(
        {
          transforms: [addModule],
          classifiers: [{ name: "mark", classify: () => ({ marked: "yes" }) }],
          rules: [configureRule(readTags)],
        },
        { cwd: "/p" },
      ),
    );
    expect(seen).toContain("/p/c.ts");
  });

  it("contributes capabilities, so a rule can require something no host provides", async () => {
    const needsTypeEdges = defineRule({
      meta: {
        name: "needs-type-edges",
        description: "",
        defaultSeverity: "error",
        requiredCapabilities: ["type-edges"],
      },
      check(ctx) {
        ctx.report({ message: "ran" });
      },
    });
    const enricher = defineTransform({
      name: "type-enricher",
      provides: ["type-edges"],
      transform: (g) => g,
    });
    const withIt = await analyze(
      graph(),
      resolveConfig(
        { transforms: [enricher], rules: [configureRule(needsTypeEdges)] },
        { cwd: "/p" },
      ),
    );
    expect(withIt.violations).toHaveLength(1);

    const withoutIt = await analyze(
      graph(),
      resolveConfig({ rules: [configureRule(needsTypeEdges)] }, { cwd: "/p" }),
    );
    expect(withoutIt.violations).toHaveLength(0);
    expect(withoutIt.diagnostics.map((d) => d.code)).toContain("rule-skipped");
  });

  it("isolates a throwing transform and does NOT grant its capabilities", async () => {
    // Same isolation a rule gets. Granting the capability anyway would let a rule run
    // against a graph that never got enriched — silently wrong instead of loudly skipped.
    const broken = defineTransform({
      name: "broken",
      provides: ["type-edges"],
      transform: () => {
        throw new Error("enricher bug");
      },
    });
    const needsTypeEdges = defineRule({
      meta: {
        name: "needs-type-edges",
        description: "",
        defaultSeverity: "error",
        requiredCapabilities: ["type-edges"],
      },
      check(ctx) {
        ctx.report({ message: "ran" });
      },
    });
    const result = await analyze(
      graph(),
      resolveConfig(
        {
          transforms: [broken],
          rules: [configureRule(countEdges), configureRule(needsTypeEdges)],
        },
        { cwd: "/p" },
      ),
    );
    expect(result.diagnostics.map((d) => d.code)).toContain("transform-failed");
    expect(result.diagnostics.map((d) => d.code)).toContain("rule-skipped");
    // The unrelated rule still ran against the untransformed graph.
    expect(result.violations.map((v) => v.message)).toEqual(["/p/a.ts->/p/b.ts"]);
  });
});

describe("dropSelfEdges", () => {
  it("removes self-edges and leaves everything else identical", () => {
    const g = buildFixtureGraph({
      modules: ["/p/a.ts", "/p/b.ts"],
      edges: [
        ["/p/a.ts", "/p/a.ts"],
        ["/p/a.ts", "/p/b.ts"],
      ],
    });
    const out = dropSelfEdges().transform(g, {
      sourceRoot: "/p",
      repoRoot: "/p",
    });
    expect(out.edges.map((e) => `${e.from}->${e.to}`)).toEqual(["/p/a.ts->/p/b.ts"]);
    expect(out.modules).toBe(g.modules);
  });
});

describe("presets as the one extension bundle", () => {
  it("can contribute transforms and reporters, not just classifiers and rules", async () => {
    // Widened instead of adding a separate `Plugin` type: shipping "archwall-preset-nx"
    // should not mean telling users to wire three things separately.
    const seen: string[] = [];
    const preset = {
      name: "bundle",
      classifiers: [],
      rules: [configureRule(countEdges)],
      transforms: [defineTransform({ name: "noop", transform: (g) => g })],
      reporters: [
        {
          name: "collect",
          onRunEnd: (r: { violations: readonly { message: string }[] }) => {
            for (const v of r.violations) seen.push(v.message);
          },
        },
      ],
    };
    const config = resolveConfig({ presets: [preset], reporters: [] }, { cwd: "/p" });
    expect(config.transforms).toHaveLength(1);
    // Appended to the user's reporters rather than replacing them.
    expect(config.reporterSpecs).toHaveLength(1);
  });
});
