import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { UserConfig } from "@archwall/core";
import { configureRule, defineRule, FINGERPRINT_SCHEME } from "@archwall/core";
import { createArchWallRun, type ProjectGraph } from "@archwall/integration-kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Baselines at the RUN EDGE.
 *
 * Everything here is behaviour `analyze` deliberately does not have: reading a file, deciding
 * what counts, and deciding whether an unmatched entry means anything. The file format itself
 * is core's, and is tested there.
 */

const host = { name: "test-host", version: "1", capabilities: new Set<never>() };

/** Reports one violation per edge — enough findings to accept, and stable ones. */
const flagEdges = configureRule(
  defineRule<Record<string, never>>({
    meta: { name: "flag-edges", description: "", defaultSeverity: "error" },
    check(ctx) {
      for (const e of ctx.graph.edges()) ctx.report({ edge: e, message: `edge to ${e.to}` });
    },
  }),
);

let dir: string;
const BASELINE = "archwall-baseline.json";
const baselinePath = (): string => path.join(dir, BASELINE);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "archwall-baseline-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const config = (over: Partial<UserConfig> = {}): UserConfig => ({
  rules: [flagEdges],
  reporters: [],
  baseline: BASELINE,
  ...over,
});

async function makeRun(over: Partial<UserConfig> = {}, delivery?: "complete" | "progressive") {
  const run = await createArchWallRun({ host, cwd: dir, config: config(over) });
  const app = path.join(dir, "app.ts");
  const graph: ProjectGraph = run
    .graphBuilder(delivery)
    .addModule({ id: app })
    .addEdge({ from: app, to: "lodash" })
    .addEdge({ from: app, to: "left-pad" })
    .build();
  return { run, graph };
}

/** Runs once with `--update-baseline` to produce a file matching the current findings. */
async function seedBaseline(over: Partial<UserConfig> = {}): Promise<void> {
  const { run, graph } = await makeRun(over);
  await run.check(graph, { updateBaseline: true });
}

describe("suppression", () => {
  it("moves accepted findings out of violations and stops them failing the run", async () => {
    const { run: first, graph: g1 } = await makeRun();
    const before = await first.check(g1);
    expect(before.result.violations).toHaveLength(2);
    expect(before.failed).toBe(true);

    await seedBaseline();
    // A NEW run: the baseline is read once at run creation, so the seeded file only takes
    // effect for a run constructed after it exists.
    const { run, graph } = await makeRun();
    const { result, failed, summary } = await run.check(graph);

    expect(result.violations).toEqual([]);
    expect(result.suppressed).toHaveLength(2);
    expect(failed).toBe(false);
    expect(summary).toContain("2 suppressed");
  });

  it("still reports a finding the baseline does not cover", async () => {
    await seedBaseline();
    const { run } = await makeRun();
    const app = path.join(dir, "app.ts");
    // Same two accepted edges plus a third nobody accepted.
    const graph = run
      .graphBuilder()
      .addModule({ id: app })
      .addEdge({ from: app, to: "lodash" })
      .addEdge({ from: app, to: "left-pad" })
      .addEdge({ from: app, to: "chalk" })
      .build();
    const { result, failed } = await run.check(graph);

    expect(result.violations.map((v) => v.message)).toEqual(["edge to pkg:chalk"]);
    expect(result.suppressed).toHaveLength(2);
    expect(failed).toBe(true);
  });

  it("leaves suppressed out of the counted severities but keeps the total recoverable", async () => {
    await seedBaseline();
    const { run, graph } = await makeRun();
    const { result } = await run.check(graph);
    // The documented invariant on `AnalysisResult.suppressed`.
    expect(result.violations.length + result.suppressed.length).toBe(2);
  });
});

describe("stale entries", () => {
  it("reports entries this run did not produce, without failing by default", async () => {
    await seedBaseline();
    const { run } = await makeRun();
    const app = path.join(dir, "app.ts");
    // One of the two accepted imports is gone — somebody fixed it.
    const graph = run
      .graphBuilder()
      .addModule({ id: app })
      .addEdge({ from: app, to: "lodash" })
      .build();
    const { result, failed } = await run.check(graph);

    const stale = result.diagnostics.filter((d) => d.code === "baseline-stale");
    expect(stale).toHaveLength(1);
    expect(stale[0]!.details).toMatchObject({ count: 1 });
    // Default off: failing CI for a fixed violation punishes the exact behaviour a baseline
    // exists to encourage.
    expect(failed).toBe(false);
  });

  it("fails when the team asks for the file to be kept honest", async () => {
    await seedBaseline();
    const { run } = await makeRun({ failOnDiagnostics: { baselineStale: true } });
    const app = path.join(dir, "app.ts");
    const graph = run.graphBuilder().addModule({ id: app }).build();
    expect((await run.check(graph)).failed).toBe(true);
  });

  it("stays silent on a progressive graph, which is partial by definition", async () => {
    await seedBaseline();
    const { run } = await makeRun({}, "progressive");
    const partial = run
      .graphBuilder("progressive")
      .addModule({ id: path.join(dir, "app.ts") })
      .build();
    const { result } = await run.check(partial);
    // Every entry went unmatched, and none of that is evidence anything was fixed.
    expect(result.diagnostics.filter((d) => d.code === "baseline-stale")).toEqual([]);
  });

  it("stays silent when a rule was skipped for missing capabilities", async () => {
    // The rule that produced the entries did not run, so its entries going unmatched says
    // nothing about the code. Pruning here would delete live enforcement.
    const needsCaps = configureRule(
      defineRule<Record<string, never>>({
        meta: {
          name: "needs-caps",
          description: "",
          defaultSeverity: "error",
          requiredCapabilities: ["import-locations"],
        },
        check() {},
      }),
    );
    await seedBaseline();
    const { run, graph } = await makeRun({ rules: [flagEdges, needsCaps] });
    const { result } = await run.check(graph);

    expect(result.diagnostics.map((d) => d.code)).toContain("rule-skipped");
    expect(result.diagnostics.filter((d) => d.code === "baseline-stale")).toEqual([]);
  });
});

describe("an unusable baseline", () => {
  it("fails the run when the configured file does not exist", async () => {
    const { run, graph } = await makeRun();
    const { result, failed } = await run.check(graph);

    const invalid = result.diagnostics.filter((d) => d.code === "baseline-invalid");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.message).toMatch(/--update-baseline/);
    // Silence here would let a deleted baseline look like a clean repo.
    expect(failed).toBe(true);
  });

  it("fails the run, by name, when the file was written under another fingerprint scheme", async () => {
    fs.writeFileSync(baselinePath(), JSON.stringify({ scheme: "aw2", entries: [] }), "utf8");
    const { run, graph } = await makeRun();
    const { result, failed } = await run.check(graph);

    const invalid = result.diagnostics.filter((d) => d.code === "baseline-invalid");
    expect(invalid[0]!.message).toMatch(/aw2/);
    expect(failed).toBe(true);
    // And nothing was suppressed on a guess.
    expect(result.suppressed).toEqual([]);
  });

  it("fails the run on malformed JSON", async () => {
    fs.writeFileSync(baselinePath(), "{ not json", "utf8");
    const { run, graph } = await makeRun();
    expect((await run.check(graph)).failed).toBe(true);
  });

  it("can be downgraded deliberately, like every other diagnostic", async () => {
    const { run, graph } = await makeRun({ failOnDiagnostics: { invalidConfig: false } });
    const { result, failed } = await run.check(graph);
    expect(result.diagnostics.map((d) => d.code)).toContain("baseline-invalid");
    expect(failed).toBe(true); // still fails — on the violations, which are now unsuppressed
    expect(result.violations).toHaveLength(2);
  });

  it("says nothing at all when no baseline is configured", async () => {
    const { run, graph } = await makeRun({ baseline: undefined });
    const { result } = await run.check(graph);
    expect(result.diagnostics.filter((d) => d.code === "baseline-invalid")).toEqual([]);
    expect(result.suppressed).toEqual([]);
  });
});

describe("--update-baseline", () => {
  it("writes the current findings and reports the path", async () => {
    const { run, graph } = await makeRun();
    const { baselineWritten, failed } = await run.check(graph, { updateBaseline: true });

    expect(baselineWritten).toBe(baselinePath());
    // Accepting the current findings is the command's job; it cannot also fail because of them.
    expect(failed).toBe(false);
    const written = JSON.parse(fs.readFileSync(baselinePath(), "utf8"));
    expect(written.scheme).toBe(FINGERPRINT_SCHEME);
    expect(written.entries).toHaveLength(2);
    expect(written.entries[0]).toMatchObject({ ruleId: "flag-edges" });
  });

  it("does not complain that the file it is about to create is missing", async () => {
    const { run, graph } = await makeRun();
    const { result } = await run.check(graph, { updateBaseline: true });
    expect(result.diagnostics.filter((d) => d.code === "baseline-invalid")).toEqual([]);
  });

  it("keeps already-accepted entries whose findings are still present", async () => {
    await seedBaseline();
    const { run } = await makeRun();
    const app = path.join(dir, "app.ts");
    const graph = run
      .graphBuilder()
      .addModule({ id: app })
      .addEdge({ from: app, to: "lodash" })
      .addEdge({ from: app, to: "left-pad" })
      .addEdge({ from: app, to: "chalk" })
      .build();
    await run.check(graph, { updateBaseline: true });

    // Rewriting from the un-suppressed remainder alone would drop the two entries the old
    // file already accepted and quietly un-suppress them on the next run.
    const written = JSON.parse(fs.readFileSync(baselinePath(), "utf8"));
    expect(written.entries).toHaveLength(3);
  });

  it("still fails when a rule crashed, rather than freezing a partial picture", async () => {
    const boom = configureRule(
      defineRule<Record<string, never>>({
        meta: { name: "boom", description: "", defaultSeverity: "error" },
        check() {
          throw new Error("kaboom");
        },
      }),
    );
    const { run, graph } = await makeRun({ rules: [flagEdges, boom] });
    const { failed } = await run.check(graph, { updateBaseline: true });
    expect(failed).toBe(true);
  });

  it("is a no-op on the file when no baseline path is configured", async () => {
    const { run, graph } = await makeRun({ baseline: undefined });
    const { baselineWritten } = await run.check(graph, { updateBaseline: true });
    expect(baselineWritten).toBeUndefined();
    expect(fs.existsSync(baselinePath())).toBe(false);
  });
});
