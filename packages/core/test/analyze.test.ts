import type {
  Capability,
  GraphDelivery,
  ModuleKind,
  ModuleNode,
  StandardSchemaV1,
} from "@archwall/core";
import {
  analyze,
  configureRule,
  defineGraphComputation,
  defineRule,
  IR_VERSION,
  IrVersionMismatchError,
  ProjectGraph,
  resolveConfig,
  THIRD_PARTY_KINDS,
} from "@archwall/core";
import { describe, expect, it } from "vitest";

function mod(
  id: string,
  tags: Record<string, string> = {},
  kind: ModuleKind = "source",
): ModuleNode {
  return {
    id,
    file: kind === "source" ? id : null,
    kind,
    tags: new Map(Object.entries(tags)),
  };
}
function graph(
  mods: ModuleNode[],
  opts: { capabilities?: Capability[]; delivery?: GraphDelivery } = {},
): ProjectGraph {
  return ProjectGraph.create({
    host: {
      name: "test",
      version: "0",
      capabilities: new Set(opts.capabilities ?? []),
    },
    delivery: opts.delivery ?? "complete",
    modules: new Map(mods.map((m) => [m.id, m])),
    edges: [],
  });
}

const flagExternals = defineRule({
  meta: { name: "flag-externals", description: "", defaultSeverity: "error" },
  check(ctx) {
    ctx.graph
      .modules({ moduleKind: THIRD_PARTY_KINDS })
      .forEach((m) => ctx.report({ module: m.id, message: `external: ${m.id}` }));
  },
});

describe("analyze", () => {
  it("classifies then checks; fills ruleName and severity", async () => {
    const g = graph([mod("a"), mod("react", {}, "package")]);
    const result = await analyze(
      g,
      resolveConfig({
        rules: [configureRule(flagExternals, {}, { severity: "warn" })],
      }),
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      ruleName: "flag-externals",
      severity: "warn",
      locations: [{ type: "module", module: "react" }],
    });
    expect(result.stats.moduleCount).toBe(2);
  });
  it("skips rules missing capabilities, loudly", async () => {
    const needsLoc = defineRule({
      meta: {
        name: "needs-loc",
        description: "",
        defaultSeverity: "error",
        requiredCapabilities: ["import-locations"],
      },
      check(ctx) {
        ctx.report({ message: "should not run" });
      },
    });
    const g = graph([mod("a")], { capabilities: [] });
    const result = await analyze(g, resolveConfig({ rules: [configureRule(needsLoc)] }));
    expect(result.violations).toHaveLength(0);
    const skipped = result.diagnostics.filter((d) => d.code === "rule-skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.details!["missingCapabilities"]).toEqual(["import-locations"]);
    expect(skipped[0]!.message).toMatch(/needs-loc/);
  });
  it("progressive delivery strips complete-graph capability", async () => {
    const needsComplete = defineRule({
      meta: {
        name: "needs-complete",
        description: "",
        defaultSeverity: "error",
        requiredCapabilities: ["complete-graph"],
      },
      check(ctx) {
        ctx.report({ message: "ran" });
      },
    });
    const g = graph([mod("a")], {
      capabilities: ["complete-graph"],
      delivery: "progressive",
    });
    const result = await analyze(g, resolveConfig({ rules: [configureRule(needsComplete)] }));
    expect(result.diagnostics.filter((d) => d.code === "rule-skipped")).toHaveLength(1);
  });
  it("validates options via Standard Schema at CONFIG time, as a diagnostic", async () => {
    const schema: StandardSchemaV1<unknown, { n: number }> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (v) =>
          typeof (v as { n?: unknown }).n === "number"
            ? { value: v as { n: number } }
            : { issues: [{ message: "n must be a number" }] },
      },
    };
    let ran = false;
    const strict = defineRule<{ n: number }>({
      meta: {
        name: "strict",
        description: "",
        defaultSeverity: "error",
        optionsSchema: schema,
      },
      check() {
        ran = true;
      },
    });
    const config = resolveConfig({
      rules: [configureRule(strict, { n: "no" as unknown as number })],
    });

    // Known before any graph exists, so it is known at config time. Throwing from inside
    // the rule loop — outside the per-rule try/catch — used to destroy every rule after it.
    expect(config.diagnostics.map((d) => d.code)).toEqual(["invalid-rule-options"]);
    expect(config.diagnostics[0]!.message).toMatch(/n must be a number/);
    expect(config.rules).toHaveLength(0);

    const result = await analyze(graph([mod("a")]), config);
    expect(ran).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain("invalid-rule-options");
  });

  it("keeps every other rule running when one rule's options are invalid", async () => {
    const schema: StandardSchemaV1<unknown, { n: number }> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: () => ({ issues: [{ message: "always invalid" }] }),
      },
    };
    const bad = defineRule<{ n: number }>({
      meta: {
        name: "bad",
        description: "",
        defaultSeverity: "error",
        optionsSchema: schema,
      },
      check() {},
    });
    const good = defineRule({
      meta: { name: "good", description: "", defaultSeverity: "error" },
      check(ctx) {
        ctx.report({ message: "still ran" });
      },
    });
    const result = await analyze(
      graph([mod("a")]),
      resolveConfig({ rules: [configureRule(bad), configureRule(good)] }),
    );
    expect(result.violations.map((v) => v.message)).toEqual(["still ran"]);
    expect(result.diagnostics.map((d) => d.code)).toContain("invalid-rule-options");
  });

  it("passes the schema's TRANSFORMED value to the rule", async () => {
    const schema: StandardSchemaV1<unknown, { n: number }> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (v) => ({ value: { n: Number((v as { n: unknown }).n) } }),
      },
    };
    let seen: unknown;
    const coercing = defineRule<{ n: number }>({
      meta: {
        name: "coercing",
        description: "",
        defaultSeverity: "error",
        optionsSchema: schema,
      },
      check(ctx) {
        seen = ctx.options;
      },
    });
    await analyze(
      graph([mod("a")]),
      resolveConfig({
        rules: [configureRule(coercing, { n: "42" as unknown as number })],
      }),
    );
    expect(seen).toEqual({ n: 42 });
  });
  it("rejects incompatible IR majors", async () => {
    const g = { ...graph([mod("a")]), irVersion: "999.0.0" };
    await expect(analyze(g, resolveConfig({}))).rejects.toThrow(IrVersionMismatchError);
  });
  it("memoizes analyses across rules in one run", async () => {
    let computes = 0;
    const counting = defineGraphComputation({
      name: "counting",
      compute: () => ++computes,
    });
    const mk = (name: string) =>
      defineRule({
        meta: { name, description: "", defaultSeverity: "error" },
        check(ctx) {
          ctx.compute(counting);
        },
      });
    await analyze(
      graph([mod("a")]),
      resolveConfig({
        rules: [configureRule(mk("r1")), configureRule(mk("r2"))],
      }),
    );
    expect(computes).toBe(1);
  });
});
