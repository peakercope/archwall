import type { Diagnostic, ModuleNode } from "@archwall/core";
import { analyze, configureRule, defineRule, ProjectGraph, resolveConfig } from "@archwall/core";
import { describe, expect, it } from "vitest";

const ROOT = "/proj";

function mod(rel: string, tags: Record<string, string> = {}): ModuleNode {
  const id = `${ROOT}/${rel}`;
  return { id, file: id, kind: "source", tags: new Map(Object.entries(tags)) };
}

function graph(mods: ModuleNode[]): ProjectGraph {
  return ProjectGraph.create({
    host: { name: "test", version: "0", capabilities: new Set() },
    delivery: "complete",
    modules: new Map(mods.map((m) => [m.id, m])),
    edges: [],
  });
}

const noop = defineRule({
  meta: { name: "noop", description: "", defaultSeverity: "error" },
  visits: { modules: { visit() {} } },
});

const MODULES = [mod("apps/web/a.ts", { layer: "app" }), mod("services/api/b.ts")];

async function diagnosticsFor(
  rules: ReturnType<typeof configureRule>[],
): Promise<readonly Diagnostic[]> {
  const result = await analyze(graph(MODULES), resolveConfig({ rules }, { cwd: ROOT }));
  return result.diagnostics;
}

/**
 * The silence doctrine, one level down.
 *
 * Global silence was already diagnosed (`empty-project`, `no-modules-classified`), but a rule
 * whose `scope` resolved to nothing ran, reported nothing, and passed green — so a typo in
 * `scope.include` looked exactly like a clean architecture. `projects` (ADR-0017) expands into
 * scopes, so this diagnostic is what keeps that feature from failing silently too.
 */
describe("empty-scope diagnostic", () => {
  it("fires when a path scope matches no modules", async () => {
    const diagnostics = await diagnosticsFor([
      configureRule(noop, {}, { scope: { include: ["apps/mobile/**"] } }),
    ]);
    const d = diagnostics.find((x) => x.code === "empty-scope");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warn");
    expect(d?.ruleId).toBe("noop");
    expect(d?.details).toMatchObject({ totalModules: 2 });
  });

  it("fires when a tag scope matches no modules", async () => {
    const diagnostics = await diagnosticsFor([
      configureRule(noop, {}, { scope: { tag: { layer: "nonexistent" } } }),
    ]);
    expect(diagnostics.some((d) => d.code === "empty-scope")).toBe(true);
  });

  it("stays silent when the scope matches something", async () => {
    const diagnostics = await diagnosticsFor([
      configureRule(noop, {}, { scope: { include: ["apps/web/**"] } }),
    ]);
    expect(diagnostics.some((d) => d.code === "empty-scope")).toBe(false);
  });

  it("stays silent for an unscoped rule", async () => {
    const diagnostics = await diagnosticsFor([configureRule(noop, {})]);
    expect(diagnostics.some((d) => d.code === "empty-scope")).toBe(false);
  });

  it("names every rule sharing one bad scope, not just the first", async () => {
    // Scoped queries are memoized by scope key. Emitting from inside that memo would report
    // once and name whichever rule happened to miss the cache — leaving the others looking
    // fine. The diagnostic is per rule precisely so the fix list is complete.
    const scope = { include: ["apps/mobile/**"] };
    const diagnostics = await diagnosticsFor([
      configureRule(noop, {}, { id: "first", scope }),
      configureRule(noop, {}, { id: "second", scope }),
    ]);
    const ruleIds = diagnostics.filter((d) => d.code === "empty-scope").map((d) => d.ruleId);
    expect(ruleIds).toEqual(["first", "second"]);
  });
});

describe("empty-scope fail gate", () => {
  it("defaults to not failing the run", () => {
    expect(resolveConfig({}, { cwd: ROOT }).failOnDiagnostics.emptyScope).toBe(false);
  });

  it("is its own switch, independent of emptyAnalysis", () => {
    const resolved = resolveConfig(
      { failOnDiagnostics: { emptyScope: true } },
      { cwd: ROOT },
    ).failOnDiagnostics;
    expect(resolved.emptyScope).toBe(true);
    expect(resolved.emptyAnalysis).toBe(false);
  });
});
