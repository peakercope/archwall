import type { AnalysisResult, BuiltinReporterName, Violation } from "@archwall/core";
import { consoleReporter, jsonReporter, resolveReporters, sarifReporter } from "@archwall/core";
import { describe, expect, it } from "vitest";

const violation: Violation = {
  ruleName: "layer-dependencies",
  ruleId: "layer-dependencies",
  severity: "error",
  message: "widgets may not import features internals",
  fingerprint: "deadbeefdeadbeef",
  edge: {
    from: "/src/widgets/w.ts",
    to: "/src/features/auth/model/store.ts",
    rawSpecifier: "@/features/auth",
    resolvedPath: "/src/features/auth/model/store.ts",
    kind: "static",
    loc: { file: "/src/widgets/w.ts", line: 3, column: 0 },
  },
  explanation: "widgets sits above features in the configured layer order",
};
const result: AnalysisResult = {
  violations: [violation],
  diagnostics: [
    {
      code: "rule-skipped",
      severity: "warn",
      ruleId: "public-api",
      message: "skipped public-api",
      details: { missingCapabilities: ["reexport-edges"], host: "test" },
    },
  ],
  stats: { moduleCount: 2, edgeCount: 1, durationMs: 1 },
  rules: [
    {
      id: "layer-dependencies",
      name: "layer-dependencies",
      description: "Enforces an ordering over layer tags.",
      docsUrl: "https://example.test/rules/layer-dependencies",
      severity: "error",
      status: "ran",
      violations: 1,
      durationMs: 1,
    },
    {
      id: "public-api",
      name: "public-api",
      description: "Enforces module entry points.",
      severity: "error",
      status: "skipped",
      violations: 0,
      durationMs: 0,
      missingCapabilities: ["reexport-edges"],
    },
  ],
  host: { name: "test", version: "0", capabilities: new Set() },
  delivery: "complete",
  repoRoot: "/src",
};
function capture() {
  const lines: string[] = [];
  return { io: { write: (l: string) => lines.push(l) }, lines };
}

describe("console reporter", () => {
  it("prints violation with resolution chain, loc, and summary", async () => {
    const { io, lines } = capture();
    const r = consoleReporter(io);
    await r.onRunStart!({
      runId: "r1",
      host: result.host,
      startedAt: 0,
      repoRoot: result.repoRoot,
    });
    await r.onViolation!(violation);
    await r.onRunEnd(result);
    const text = lines.join("\n");
    expect(text).toContain("[error] layer-dependencies:");
    expect(text).toContain("1 error(s), 0 warning(s)");
    expect(text).toContain("skipped public-api");
  });

  it("prints project-relative paths, never absolute ones", async () => {
    const { io, lines } = capture();
    const r = consoleReporter(io);
    await r.onRunStart!({
      runId: "r1",
      host: result.host,
      startedAt: 0,
      repoRoot: result.repoRoot,
    });
    await r.onViolation!(violation);
    const text = lines.join("\n");
    expect(text).toContain("widgets/w.ts:3:0");
    expect(text).toContain('"@/features/auth" → resolves to features/auth/model/store.ts');
    expect(text).not.toContain("/src/widgets");
  });

  it("does not double-print violations already streamed", async () => {
    const { io, lines } = capture();
    const r = consoleReporter(io);
    await r.onViolation!(violation);
    await r.onRunEnd(result);
    const count = lines.join("\n").split("[error] layer-dependencies:").length - 1;
    expect(count).toBe(1);
  });
});

describe("json reporter", () => {
  it("emits parseable JSON with violations", async () => {
    const { io, lines } = capture();
    await jsonReporter(io).onRunEnd(result);
    const doc = JSON.parse(lines.join("\n"));
    expect(doc.violations).toHaveLength(1);
    expect(doc.violations[0].ruleName).toBe("layer-dependencies");
    expect(doc.diagnostics[0].code).toBe("rule-skipped");
  });

  it("relativizes paths so the document is machine-independent", async () => {
    const { io, lines } = capture();
    await jsonReporter(io).onRunEnd(result);
    const doc = JSON.parse(lines.join("\n"));
    expect(doc.violations[0].edge.from).toBe("widgets/w.ts");
    expect(doc.violations[0].edge.to).toBe("features/auth/model/store.ts");
    expect(doc.violations[0].edge.loc.file).toBe("widgets/w.ts");
  });
});

describe("sarif reporter", () => {
  it("emits SARIF 2.1.0 with ruleId/level/location", async () => {
    const { io, lines } = capture();
    await sarifReporter(io).onRunEnd(result);
    const doc = JSON.parse(lines.join("\n"));
    expect(doc.version).toBe("2.1.0");
    expect(doc.runs[0].tool.driver.name).toBe("archwall");
    const res = doc.runs[0].results[0];
    expect(res.ruleId).toBe("layer-dependencies");
    expect(res.level).toBe("error");
    expect(res.locations[0].physicalLocation.region.startLine).toBe(3);
  });

  it("emits a root-relative artifact URI, which GitHub code scanning requires", async () => {
    const { io, lines } = capture();
    await sarifReporter(io).onRunEnd(result);
    const doc = JSON.parse(lines.join("\n"));
    const uri = doc.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri;
    // An absolute path here is silently useless: GitHub cannot associate the result
    // with a file in the repository.
    expect(uri).toBe("widgets/w.ts");
    expect(uri.startsWith("/")).toBe(false);
  });

  it("describes rules from the inventory, including ones that found nothing", async () => {
    // `tool.driver.rules` used to be bare `{ id }` entries derived from the violations,
    // while `meta.description` and `meta.docsUrl` sat unread — and a rule that found
    // nothing never appeared at all.
    const { io, lines } = capture();
    await sarifReporter(io).onRunEnd(result);
    const rules = JSON.parse(lines.join("\n")).runs[0].tool.driver.rules;
    expect(rules.map((r: { id: string }) => r.id).sort()).toEqual([
      "layer-dependencies",
      "public-api",
    ]);
    const layered = rules.find((r: { id: string }) => r.id === "layer-dependencies");
    expect(layered.shortDescription.text).toBe("Enforces an ordering over layer tags.");
    expect(layered.helpUri).toBe("https://example.test/rules/layer-dependencies");
    // No docsUrl configured, so no helpUri — never a relative or invented one.
    expect(rules.find((r: { id: string }) => r.id === "public-api").helpUri).toBeUndefined();
  });

  it("reports diagnostics as tool notifications rather than dropping them", async () => {
    // SARIF is the CI-integrated path, which is exactly where "ArchWall never looked at
    // your code" most needs to be visible.
    const { io, lines } = capture();
    await sarifReporter(io).onRunEnd(result);
    const invocation = JSON.parse(lines.join("\n")).runs[0].invocations[0];
    expect(invocation.toolExecutionNotifications).toHaveLength(1);
    expect(invocation.toolExecutionNotifications[0].descriptor.id).toBe("rule-skipped");
    expect(invocation.executionSuccessful).toBe(true);
  });

  it("carries the fingerprint so consumers can track a finding across commits", async () => {
    const { io, lines } = capture();
    await sarifReporter(io).onRunEnd(result);
    const doc = JSON.parse(lines.join("\n"));
    expect(doc.runs[0].results[0].partialFingerprints.archwall).toBe("deadbeefdeadbeef");
  });
});

describe("resolveReporters", () => {
  it("maps names to built-ins and passes customs through", () => {
    const custom = { name: "x", onRunEnd: () => {} };
    const rs = resolveReporters(["console", "sarif", custom]);
    expect(rs.map((r) => r.name)).toEqual(["console", "sarif", "x"]);
    expect(rs[2]).toBe(custom);
  });
  it("throws on unknown names", () => {
    expect(() => resolveReporters(["nope" as BuiltinReporterName])).toThrow(/unknown reporter/i);
  });
});
