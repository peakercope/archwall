import { analyze, defineRule, ProjectGraph, resolveConfig } from "@archwall/core";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

/**
 * The per-call options parameter, and the graph identity a future incremental implementation
 * will key on. Both exist ahead of most of their eventual behaviour, so what is asserted here
 * is mostly the CONTRACT — that the seam is present, honoured where it claims to be, and inert
 * where it says it is reserved.
 */

const alwaysReports = defineRule<Record<string, never>>({
  meta: {
    name: "always-reports",
    description: "Reports once per edge; exists to be interrupted.",
    defaultSeverity: "error",
    messages: { hit: "hit {from}" },
  },
  visits: {
    edges: {
      visit(e, ctx) {
        ctx.report({ edge: e, messageId: "hit", data: { from: e.from } });
      },
    },
  },
});

const wholeGraph = defineRule<Record<string, never>>({
  meta: {
    name: "whole-graph",
    description: "Uses check(), the other dispatch path.",
    defaultSeverity: "error",
    messages: { hit: "hit" },
  },
  check(ctx) {
    for (const _ of ctx.graph.moduleIds()) ctx.report({ messageId: "hit" });
  },
});

const config = (rules: Parameters<typeof resolveConfig>[0]["rules"]) =>
  resolveConfig({ rules }, { cwd: "/repo" });

const twoModules = () =>
  buildFixtureGraph({
    modules: ["/repo/a.ts", "/repo/b.ts"],
    edges: [["/repo/a.ts", "/repo/b.ts"]],
  });

describe("analyze options", () => {
  it("runs normally when no options are passed at all", async () => {
    const result = await analyze(twoModules(), config([alwaysReports()]));
    expect(result.violations).toHaveLength(1);
  });

  it("runs normally when an un-aborted signal is passed", async () => {
    const controller = new AbortController();
    const result = await analyze(twoModules(), config([alwaysReports()]), {
      signal: controller.signal,
    });
    expect(result.violations).toHaveLength(1);
  });

  it("throws the signal's reason when already aborted, before any rule runs", async () => {
    const controller = new AbortController();
    const reason = new Error("superseded by a newer rebuild");
    controller.abort(reason);
    await expect(
      analyze(twoModules(), config([alwaysReports()]), { signal: controller.signal }),
    ).rejects.toThrow(reason);
  });

  it("aborts a whole-graph rule between rules rather than mid-check", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      analyze(twoModules(), config([wholeGraph()]), { signal: controller.signal }),
    ).rejects.toThrow();
  });

  it("accepts `previous` and ignores it — the field is reserved, not honoured", async () => {
    const graph = twoModules();
    const resolved = config([alwaysReports()]);
    const first = await analyze(graph, resolved);
    const second = await analyze(graph, resolved, { previous: first });
    // Identical output, and specifically NOT a short-circuited empty result.
    expect(second.violations).toHaveLength(first.violations.length);
    expect(second.violations[0]?.fingerprint).toBe(first.violations[0]?.fingerprint);
  });
});

describe("ProjectGraph.revision", () => {
  it("gives distinct graphs distinct revisions", () => {
    expect(twoModules().revision).not.toBe(twoModules().revision);
  });

  it("honours an explicitly supplied revision", () => {
    const graph = ProjectGraph.create({
      host: { name: "test", version: "0", capabilities: new Set() },
      modules: [],
      edges: [],
      revision: 42,
    });
    expect(graph.revision).toBe(42);
  });

  /**
   * The prepare pipeline derives graphs via `replaceStores`. Those derivations are pure
   * functions of this graph plus the config, so they must NOT look like a new graph — a cache
   * keyed on `(revision, configKey)` would otherwise miss on every run.
   */
  it("survives the boundary/classify pipeline", async () => {
    const graph = twoModules();
    const seen: number[] = [];
    const probe = defineRule<Record<string, never>>({
      meta: { name: "probe", description: "captures the prepared graph", defaultSeverity: "info" },
      check(ctx) {
        for (const id of ctx.graph.moduleIds()) void id;
        seen.push(graph.revision);
      },
    });
    await analyze(graph, config([probe()]));
    expect(seen).toEqual([graph.revision]);
  });
});
