import { analyze, configureRule, defineRule, resolveConfig } from "@archwall/core";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

/** Reports one violation per edge, in graph order. */
const flagEdges = defineRule({
  meta: { name: "flag-edges", description: "", defaultSeverity: "error" },
  check(ctx) {
    for (const e of ctx.graph.edges()) ctx.report({ edge: e, message: `edge ${e.from}->${e.to}` });
  },
});

const g = (root: string) =>
  buildFixtureGraph({
    modules: [
      {
        id: `${root}/src/a.ts`,
        file: `${root}/src/a.ts`,
        tags: { layer: "app" },
      },
      {
        id: `${root}/src/b.ts`,
        file: `${root}/src/b.ts`,
        tags: { layer: "app" },
      },
    ],
    edges: [{ from: `${root}/src/a.ts`, to: `${root}/src/b.ts`, rawSpecifier: "./b" }],
  });

const run = (root: string) =>
  analyze(g(root), resolveConfig({ rules: [configureRule(flagEdges)] }, { cwd: root }));

describe("violation fingerprints", () => {
  it("are identical for the same finding on different machines", async () => {
    // The whole point: a baseline file committed by one developer must match what CI
    // and every other developer compute for the same architecture problem.
    const alice = await run("/home/alice/proj");
    const bob = await run("/Users/bob/work/proj");
    expect(alice.violations[0]!.fingerprint).toBe(bob.violations[0]!.fingerprint);
  });

  it("differ when the finding differs", async () => {
    const one = await run("/proj");
    const other = await analyze(
      buildFixtureGraph({
        modules: [
          { id: "/proj/src/a.ts", file: "/proj/src/a.ts" },
          { id: "/proj/src/c.ts", file: "/proj/src/c.ts" },
        ],
        edges: [{ from: "/proj/src/a.ts", to: "/proj/src/c.ts", rawSpecifier: "./c" }],
      }),
      resolveConfig({ rules: [configureRule(flagEdges)] }, { cwd: "/proj" }),
    );
    expect(one.violations[0]!.fingerprint).not.toBe(other.violations[0]!.fingerprint);
  });

  it("carry a scheme version, so a future algorithm change can error instead of mismatching", async () => {
    // Impossible to add once the first baseline ships: without a prefix, changing
    // `fingerprintOf` silently invalidates every entry instead of being detectable.
    const { violations } = await run("/proj");
    expect(violations[0]!.fingerprint).toMatch(/^aw3:[0-9a-f]{16}$/);
  });

  it("identify a finding by an explicit member set when it has no single location", async () => {
    // The cycle case. `identity` is order-insensitive and independent of which member
    // happens to sort first, so an unrelated file appearing earlier cannot churn it.
    const members = defineRule({
      meta: { name: "members", description: "", defaultSeverity: "error" },
      check(ctx) {
        ctx.report({
          module: "/proj/src/a.ts",
          identity: ["/proj/src/b.ts", "/proj/src/a.ts"],
          message: "x",
        });
      },
    });
    const reordered = defineRule({
      meta: { name: "members", description: "", defaultSeverity: "error" },
      check(ctx) {
        ctx.report({
          module: "/proj/src/b.ts",
          identity: ["/proj/src/a.ts", "/proj/src/b.ts"],
          message: "x",
        });
      },
    });
    const cfg = (r: typeof members) =>
      resolveConfig({ rules: [configureRule(r)] }, { cwd: "/proj" });
    const a = await analyze(g("/proj"), cfg(members));
    const b = await analyze(g("/proj"), cfg(reordered));
    expect(a.violations[0]!.fingerprint).toBe(b.violations[0]!.fingerprint);
  });

  it("survive a reworded rule message", async () => {
    const reworded = defineRule({
      meta: { name: "flag-edges", description: "", defaultSeverity: "error" },
      check(ctx) {
        for (const e of ctx.graph.edges())
          ctx.report({ edge: e, message: "completely different wording" });
      },
    });
    const before = await run("/proj");
    const after = await analyze(
      g("/proj"),
      resolveConfig({ rules: [configureRule(reworded)] }, { cwd: "/proj" }),
    );
    // Identity is the finding, not its prose — otherwise improving an error message
    // silently invalidates every baseline entry that rule ever produced.
    expect(after.violations[0]!.fingerprint).toBe(before.violations[0]!.fingerprint);
  });
});

/**
 * What a committed baseline SURVIVES, and what it does not.
 *
 * Both halves are the contract. A baseline is a long-lived artifact that outlives the refactor
 * that follows it, so "this entry stopped matching" has to be a fact someone decided rather
 * than something they discover in CI.
 */
describe("baseline entry stability", () => {
  const withEdge = (over: { rawSpecifier?: string; kind?: string; hostName?: string }) =>
    buildFixtureGraph({
      modules: [
        { id: "/proj/src/a.ts", file: "/proj/src/a.ts" },
        { id: "/proj/src/b.ts", file: "/proj/src/b.ts" },
      ],
      edges: [
        {
          from: "/proj/src/a.ts",
          to: "/proj/src/b.ts",
          rawSpecifier: over.rawSpecifier ?? "./b",
          ...(over.kind !== undefined ? { kind: over.kind } : {}),
        },
      ],
      ...(over.hostName !== undefined ? { hostName: over.hostName } : {}),
    });

  const fingerprint = async (graph: ReturnType<typeof withEdge>, cwd = "/proj") =>
    (await analyze(graph, resolveConfig({ rules: [configureRule(flagEdges)] }, { cwd })))
      .violations[0]!.fingerprint;

  it("survives an alias rewritten to a relative specifier", async () => {
    // Vite expands an alias before any plugin sees it; the CLI does not. Including the raw
    // specifier would make one architectural fact fingerprint differently per bundler.
    expect(await fingerprint(withEdge({ rawSpecifier: "@/b" }))).toBe(
      await fingerprint(withEdge({ rawSpecifier: "./b" })),
    );
  });

  it("survives an edge reclassified from static to reexport", async () => {
    // `reexport` versus `static` is capability-gated, so a host that gains the capability
    // must not invalidate every entry about that edge.
    expect(await fingerprint(withEdge({ kind: "reexport" }))).toBe(
      await fingerprint(withEdge({ kind: "static" })),
    );
  });

  it("survives a change of host", async () => {
    expect(await fingerprint(withEdge({ hostName: "vite" }))).toBe(
      await fingerprint(withEdge({ hostName: "cli" })),
    );
  });

  it("does NOT survive moving the file — a documented limitation", async () => {
    // Identity is (rule instance, locations), and a moved file IS a different location. Worth
    // asserting rather than assuming: it is what a team hits on their first big refactor, and
    // the answer is `--update-baseline`, not a bug report.
    const moved = buildFixtureGraph({
      modules: [
        { id: "/proj/src/moved/a.ts", file: "/proj/src/moved/a.ts" },
        { id: "/proj/src/b.ts", file: "/proj/src/b.ts" },
      ],
      edges: [{ from: "/proj/src/moved/a.ts", to: "/proj/src/b.ts", rawSpecifier: "../b" }],
    });
    expect(await fingerprint(moved)).not.toBe(await fingerprint(withEdge({})));
  });

  it("does NOT survive renaming the rule instance", async () => {
    // The instance id is half the identity, which is what keeps two instances of one rule at
    // different scopes from sharing baseline entries.
    const renamed = await analyze(
      withEdge({}),
      resolveConfig(
        { rules: [configureRule(flagEdges, {}, { id: "flag-edges-web" })] },
        { cwd: "/proj" },
      ),
    );
    expect(renamed.violations[0]!.fingerprint).not.toBe(await fingerprint(withEdge({})));
  });
});

describe("deterministic ordering", () => {
  it("sorts violations independently of module insertion order", async () => {
    const forward = buildFixtureGraph({
      modules: ["/p/a.ts", "/p/b.ts", "/p/c.ts"].map((id) => ({
        id,
        file: id,
      })),
      edges: [
        { from: "/p/a.ts", to: "/p/b.ts" },
        { from: "/p/c.ts", to: "/p/b.ts" },
      ],
    });
    const reversed = buildFixtureGraph({
      modules: ["/p/c.ts", "/p/b.ts", "/p/a.ts"].map((id) => ({
        id,
        file: id,
      })),
      edges: [
        { from: "/p/c.ts", to: "/p/b.ts" },
        { from: "/p/a.ts", to: "/p/b.ts" },
      ],
    });
    const cfg = resolveConfig({ rules: [configureRule(flagEdges)] }, { cwd: "/p" });
    const a = (await analyze(forward, cfg)).violations.map((v) => v.message);
    const b = (await analyze(reversed, cfg)).violations.map((v) => v.message);
    // Hosts iterate modules in different orders; output must not depend on that.
    expect(a).toEqual(b);
  });
});

describe("per-rule error isolation", () => {
  const boom = defineRule({
    meta: { name: "boom", description: "", defaultSeverity: "error" },
    check() {
      throw new Error("third-party rule bug");
    },
  });

  it("reports a crashed rule as a diagnostic and still runs the others", async () => {
    const result = await analyze(
      g("/proj"),
      resolveConfig({ rules: [configureRule(boom), configureRule(flagEdges)] }, { cwd: "/proj" }),
    );
    // One broken rule must not destroy the other thirty-nine results.
    expect(result.violations).toHaveLength(1);
    const failed = result.diagnostics.filter((d) => d.code === "rule-failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.ruleId).toBe("boom");
    expect(failed[0]!.message).toMatch(/third-party rule bug/);
  });
});

describe("per-violation severity", () => {
  it("lets a rule grade a single finding above its configured default", async () => {
    const graded = defineRule({
      meta: { name: "graded", description: "", defaultSeverity: "warn" },
      check(ctx) {
        for (const e of ctx.graph.edges())
          ctx.report({ edge: e, message: "big", severity: "error" });
      },
    });
    const result = await analyze(
      g("/proj"),
      resolveConfig({ rules: [configureRule(graded)] }, { cwd: "/proj" }),
    );
    expect(result.violations[0]!.severity).toBe("error");
  });

  it("falls back to the configured severity", async () => {
    const result = await analyze(
      g("/proj"),
      resolveConfig(
        { rules: [configureRule(flagEdges, {}, { severity: "warn" })] },
        { cwd: "/proj" },
      ),
    );
    expect(result.violations[0]!.severity).toBe("warn");
  });
});
