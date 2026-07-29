import * as path from "node:path";
// Rule authoring is a CORE concern, not an adapter one — integration-kit deliberately
// stopped re-exporting all of core, so there is exactly one import path for each symbol.
import { configureRule, defineRule, primaryModule } from "@archwall/core";
import { createArchWallRun, loadConfig } from "@archwall/integration-kit";
import { describe, expect, it } from "vitest";

const host = {
  name: "test-host",
  version: "1",
  capabilities: new Set<never>(),
};
const fixtureDir = path.join(import.meta.dirname, "fixtures/config-app");

describe("loadConfig", () => {
  it("discovers archwall.config.ts in cwd", async () => {
    const { config, configFile } = await loadConfig({ cwd: fixtureDir });
    expect(configFile).toMatch(/archwall\.config\.ts$/);
    expect(config.failOn).toBe("error");
  });
  it("returns empty config when none found", async () => {
    const { config, configFile } = await loadConfig({
      cwd: import.meta.dirname,
    });
    expect(configFile).toBeNull();
    expect(config).toEqual({});
  });
  it("throws on explicit missing path", async () => {
    await expect(loadConfig({ configPath: "/nope/archwall.config.ts" })).rejects.toThrow(/nope/);
  });
});

describe("createArchWallRun", () => {
  const appFile = path.join(fixtureDir, "app.ts");

  it("loads config, analyzes, drives reporters, computes failed + summary", async () => {
    const lines: string[] = [];
    const run = await createArchWallRun({
      host,
      cwd: fixtureDir,
      io: { open: () => ({ write: (l: string) => lines.push(l) }) },
    });
    const graph = run
      .graphBuilder()
      .addModule({ id: appFile })
      .addEdge({ from: appFile, to: "lodash" })
      .build();
    const { result, failed, summary } = await run.check(graph);
    expect(result.violations).toHaveLength(1);
    expect(failed).toBe(true);
    expect(summary).toContain("1 error(s)");
    const doc = JSON.parse(lines.join("\n")); // fixture config uses the json reporter
    expect(doc.violations[0].ruleName).toBe("ban-externals");
  });

  it("inline config wins and failOn never never fails", async () => {
    const run = await createArchWallRun({
      host,
      cwd: fixtureDir,
      config: { failOn: "never", reporters: [] },
    });
    const graph = run.graphBuilder().addModule({ id: appFile }).build();
    const { failed } = await run.check(graph);
    expect(failed).toBe(false);
  });

  it("re-kinds a module outside the project root as excluded rather than deleting it", async () => {
    // A rule written against `excluded` is what makes the boundary decision observable:
    // the node must survive with a new kind, because an edge into it is still a true fact
    // about the graph.
    const flagExcluded = configureRule(
      defineRule<Record<string, never>>({
        meta: {
          name: "flag-excluded",
          description: "",
          defaultSeverity: "error",
        },
        check(ctx) {
          ctx.graph.modules({ moduleKind: "excluded" }).forEach((m) => {
            ctx.report({ module: m.id, message: `excluded ${m.id}` });
          });
        },
      }),
    );
    const run = await createArchWallRun({
      host,
      cwd: fixtureDir,
      config: { rules: [flagExcluded], failOn: "never", reporters: [] },
    });
    const graph = run.graphBuilder().addModule({ id: "/elsewhere/app.ts" }).build();
    const { result } = await run.check(graph);
    expect(result.violations.map((v) => primaryModule(v))).toEqual(["file:/elsewhere/app.ts"]);
  });

  it("fails the run when a rule crashes, even though it produced no violations", async () => {
    // The worst possible outcome for an enforcement tool: `rule-failed` was a
    // `severity: "error"` diagnostic that counted for nothing, so a rule throwing in CI
    // passed green. Crash isolation keeps the OTHER rules' results; it must not launder
    // the crash into a pass.
    const boom = configureRule(
      defineRule<Record<string, never>>({
        meta: { name: "boom", description: "throws", defaultSeverity: "error" },
        check() {
          throw new Error("kaboom");
        },
      }),
    );
    const run = await createArchWallRun({
      host,
      cwd: fixtureDir,
      config: { rules: [boom], failOn: "error", reporters: [] },
    });
    const graph = run.graphBuilder().addModule({ id: appFile }).build();
    const { result, failed, summary } = await run.check(graph);

    expect(result.violations).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toContain("rule-failed");
    expect(failed).toBe(true);
    expect(summary).toContain("blocking diagnostic");
  });

  it("lets a crashed rule be downgraded to non-blocking on purpose", async () => {
    const boom = configureRule(
      defineRule<Record<string, never>>({
        meta: { name: "boom", description: "throws", defaultSeverity: "error" },
        check() {
          throw new Error("kaboom");
        },
      }),
    );
    const run = await createArchWallRun({
      host,
      cwd: fixtureDir,
      config: {
        rules: [boom],
        failOn: "error",
        reporters: [],
        failOnDiagnostics: { ruleFailed: false },
      },
    });
    const graph = run.graphBuilder().addModule({ id: appFile }).build();
    const { failed } = await run.check(graph);
    expect(failed).toBe(false);
  });

  it("gives every run a distinct id and does not accumulate state across runs", async () => {
    // The watch-mode leak: the run object is memoized across rebuilds in both bundler
    // adapters, so a reporter built once outlives every rebuild. The console reporter's
    // dedup set was never cleared and retained every Violation object ever produced.
    const perRunLineCounts: number[] = [];
    let lines = 0;
    const run = await createArchWallRun({
      host,
      cwd: fixtureDir,
      io: { open: () => ({ write: () => void lines++ }) },
      config: { reporters: ["console"], failOn: "never" },
    });
    const graph = () =>
      run
        .graphBuilder()
        .addModule({ id: appFile })
        .addEdge({ from: appFile, to: "lodash" })
        .build();

    for (let i = 0; i < 3; i++) {
      lines = 0;
      await run.check(graph());
      perRunLineCounts.push(lines);
    }

    // Identical input, so identical output every time. A retained dedup set would make
    // later runs print fewer lines as it "recognised" violations from earlier ones.
    expect(new Set(perRunLineCounts).size).toBe(1);
  });

  it("hands reporters a distinct runId per analysis", async () => {
    const runIds: string[] = [];
    const run = await createArchWallRun({
      host,
      cwd: fixtureDir,
      config: {
        failOn: "never",
        reporters: [
          {
            name: "spy",
            onRunStart: (i) => void runIds.push(i.runId),
            onRunEnd: () => {},
          },
        ],
      },
    });
    await run.check(run.graphBuilder().addModule({ id: appFile }).build());
    await run.check(run.graphBuilder().addModule({ id: appFile }).build());
    expect(runIds).toHaveLength(2);
    expect(runIds[0]).not.toBe(runIds[1]);
  });

  it("warns when nothing was analysed, instead of reporting a falsely clean run", async () => {
    const run = await createArchWallRun({
      host,
      cwd: fixtureDir,
      io: { open: () => ({ write: () => {} }) },
    });
    const graph = run.graphBuilder().addModule({ id: "/elsewhere/app.ts" }).build();
    const { result } = await run.check(graph);
    // The tool's most dangerous failure mode is silence: zero violations because it
    // never looked at anything must not be indistinguishable from a clean codebase.
    expect(result.diagnostics.map((d) => d.code)).toContain("empty-project");
  });
});
