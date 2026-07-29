import type { ModuleNode } from "@archwall/core";
import { analyze, configureRule, defineRule, ProjectGraph, resolveConfig } from "@archwall/core";
import { describe, expect, it } from "vitest";

function mod(id: string): ModuleNode {
  return { id, file: id, kind: "source", tags: new Map([["layer", "app"]]) };
}

function graph(ids: string[]): ProjectGraph {
  return ProjectGraph.create({
    host: { name: "test", version: "0", capabilities: new Set() },
    delivery: "complete",
    modules: new Map(ids.map((id) => [id, mod(id)])),
    edges: [],
  });
}

/** Reports on every module it sees, then throws on the one named `boom`. */
const reportsThenThrows = defineRule({
  meta: { name: "reports-then-throws", description: "", defaultSeverity: "error" },
  visits: {
    modules: {
      visit(m, ctx) {
        ctx.report({ module: m.id, message: `saw ${m.id}` });
        if (m.id === "boom") throw new Error("rule exploded");
      },
    },
  },
});

const reportsEverything = defineRule({
  meta: { name: "reports-everything", description: "", defaultSeverity: "error" },
  visits: {
    modules: {
      visit(m, ctx) {
        ctx.report({ module: m.id, message: `saw ${m.id}` });
      },
    },
  },
});

const throwsInCheck = defineRule({
  meta: { name: "throws-in-check", description: "", defaultSeverity: "error" },
  check(ctx) {
    ctx.report({ module: "a", message: "found something" });
    throw new Error("check exploded");
  },
});

describe("a crashed rule produces no results", () => {
  // The `rule-failed` diagnostic says the rule "threw and produced no results". It used to be
  // a lie: `ctx.report` pushes into the shared list and nothing removed the entries. A rule
  // that died partway through the graph reported from a partial view, and the absence of a
  // finding it never reached is not evidence of anything — least of all in a baseline.
  it("discards the violations it reported before throwing", async () => {
    const result = await analyze(
      graph(["a", "boom", "z"]),
      resolveConfig({ rules: [configureRule(reportsThenThrows, {})] }),
    );
    expect(result.violations).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toContain("rule-failed");
  });

  it("reports 0 violations in its RuleRunInfo, agreeing with the result", async () => {
    const result = await analyze(
      graph(["a", "boom"]),
      resolveConfig({ rules: [configureRule(reportsThenThrows, {})] }),
    );
    const info = result.rules.find((r) => r.id === "reports-then-throws");
    expect(info).toMatchObject({ status: "failed", violations: 0 });
  });

  it("discards findings from a whole-graph `check` rule too", async () => {
    const result = await analyze(
      graph(["a"]),
      resolveConfig({ rules: [configureRule(throwsInCheck, {})] }),
    );
    expect(result.violations).toEqual([]);
  });

  it("keeps every other rule's findings — isolation is per rule", async () => {
    const result = await analyze(
      graph(["a", "boom", "z"]),
      resolveConfig({
        rules: [configureRule(reportsThenThrows, {}), configureRule(reportsEverything, {})],
      }),
    );
    expect(result.violations.map((v) => v.ruleId)).toEqual([
      "reports-everything",
      "reports-everything",
      "reports-everything",
    ]);
    expect(result.rules.find((r) => r.id === "reports-everything")).toMatchObject({
      status: "ran",
      violations: 3,
    });
  });

  it("does not discard a rule that merely found nothing", async () => {
    const result = await analyze(
      graph(["a", "z"]),
      resolveConfig({ rules: [configureRule(reportsEverything, {})] }),
    );
    expect(result.violations).toHaveLength(2);
    expect(result.rules[0]).toMatchObject({ status: "ran", violations: 2 });
  });
});
