import {
  analyze,
  configureRule,
  defineRule,
  defineTransform,
  dropSelfEdges,
  GraphQuery,
  resolveConfig,
} from "@archwall/core";
import { prepareGraph } from "@archwall/core/internal";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

/**
 * The pipeline is `boundary → transform → boundary → classify → check`.
 *
 * A transform is the slot a third party — or the planned TypeScript type-edge enricher —
 * uses to ADD facts the bundler could not supply. It writes through a mutation API rather
 * than returning a new graph, which is what keeps the graph's representation out of the IR
 * contract.
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
      transform(g) {
        g.addEdge({
          from: "/p/b.ts",
          to: "/p/a.ts",
          rawSpecifier: "./a",
          resolvedPath: "/p/a.ts",
          kind: "type",
        });
      },
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
      transform(g) {
        g.addModule({ id: "/p/c.ts", file: "/p/c.ts", kind: "source", tags: new Map() });
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

  it("boundary-checks what a transform adds, exactly as if a producer had supplied it", () => {
    // The old pipeline applied the boundary before transforms and never again, so a module
    // a transform added skipped it entirely — a `.test.ts` contributed by an enricher
    // stayed `source` on the transform path and was `excluded` without one. Same config,
    // different answer, chosen by a condition unrelated to semantics.
    const addExcluded = defineTransform({
      name: "add-test-file",
      transform(g) {
        g.addModule({ id: "/p/c.test.ts", file: "/p/c.test.ts", kind: "source", tags: new Map() });
      },
    });
    const out = prepareGraph(
      graph(),
      { sourceRoot: "/p", repoRoot: "/p", include: ["**"], exclude: ["**/*.test.*"] },
      [addExcluded],
      [],
    ).graph;
    expect(out.module("/p/c.test.ts")!.kind).toBe("excluded");
    expect(out.module("/p/a.ts")!.kind).toBe("source");
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
      transform() {},
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
      transform() {
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

  it("discards a partial write when a transform throws mid-way", () => {
    const halfway = defineTransform({
      name: "halfway",
      transform(g) {
        g.addModule({ id: "/p/z.ts", file: "/p/z.ts", kind: "source", tags: new Map() });
        throw new Error("bug after writing");
      },
    });
    const out = prepareGraph(
      graph(),
      { sourceRoot: "/p", repoRoot: "/p", include: ["**"], exclude: [] },
      [halfway],
      [],
    );
    expect(out.graph.hasModule("/p/z.ts")).toBe(false);
    expect(out.diagnostics.map((d) => d.code)).toEqual(["transform-failed"]);
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
    const out = prepareGraph(
      g,
      { sourceRoot: "/p", repoRoot: "/p", include: ["**"], exclude: [] },
      [dropSelfEdges()],
      [],
    ).graph;
    expect(out.edges().map((e) => `${e.from}->${e.to}`)).toEqual(["/p/a.ts->/p/b.ts"]);
    expect(new GraphQuery(out).moduleCount()).toBe(2);
  });
});

describe("presets as the one extension bundle", () => {
  it("can contribute transforms and reporters, not just classifiers and rules", () => {
    // Widened instead of adding a separate `Plugin` type: shipping "archwall-preset-nx"
    // should not mean telling users to wire three things separately.
    const preset = {
      name: "bundle",
      classifiers: [],
      rules: [configureRule(countEdges)],
      transforms: [defineTransform({ name: "noop", transform() {} })],
      reporters: [
        {
          name: "collect",
          onRunEnd: () => {},
        },
      ],
    };
    const config = resolveConfig({ presets: [preset], reporters: [] }, { cwd: "/p" });
    expect(config.transforms).toHaveLength(1);
    // Appended to the user's reporters rather than replacing them.
    expect(config.reporterSpecs).toHaveLength(1);
  });
});
