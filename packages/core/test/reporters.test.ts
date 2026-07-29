import type { AnalysisResult, Edge, OutputSink, ReporterIO, Violation } from "@archwall/core";
import { consoleReporter, jsonReporter, resolveReporters, sarifReporter } from "@archwall/core";
import { describe, expect, it } from "vitest";

const edge: Edge = {
  from: "/src/widgets/w.ts",
  to: "/src/features/auth/model/store.ts",
  rawSpecifier: "@/features/auth",
  resolvedPath: "/src/features/auth/model/store.ts",
  kind: "static",
  loc: { file: "/src/widgets/w.ts", line: 3, column: 0 },
};
const violation: Violation = {
  ruleName: "layer-dependencies",
  ruleId: "layer-dependencies",
  severity: "error",
  message: "widgets may not import features internals",
  messageId: "higherLayer",
  data: { fromLayer: "widgets", toLayer: "features" },
  fingerprint: "deadbeefdeadbeef",
  locations: [{ type: "edge", edge }],
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

function capture(): { sink: OutputSink; lines: string[] } {
  const lines: string[] = [];
  return { sink: { write: (l: string) => lines.push(l) }, lines };
}

/** A ReporterIO that records which destinations were opened and what went to each. */
function captureIO(): { io: ReporterIO; written: Map<string, string[]> } {
  const written = new Map<string, string[]>();
  return {
    written,
    io: {
      open(destination) {
        const lines: string[] = [];
        written.set(destination, lines);
        return { write: (l: string) => lines.push(l) };
      },
    },
  };
}

describe("console reporter", () => {
  it("prints violation with resolution chain, loc, and summary", async () => {
    const { sink, lines } = capture();
    await consoleReporter(sink).onRunEnd(result);
    const text = lines.join("\n");
    expect(text).toContain("[error] layer-dependencies:");
    expect(text).toContain("1 error(s), 0 warning(s)");
    expect(text).toContain("skipped public-api");
  });

  it("prints project-relative paths, never absolute ones", async () => {
    const { sink, lines } = capture();
    await consoleReporter(sink).onRunEnd(result);
    const text = lines.join("\n");
    expect(text).toContain("widgets/w.ts:3:0");
    expect(text).toContain('"@/features/auth" → resolves to features/auth/model/store.ts');
    expect(text).not.toContain("/src/widgets");
  });

  it("prints each violation exactly once", async () => {
    // Guards the reason `onViolation` was removed: two channels over one list meant the
    // console reporter had to carry a `seen` set to avoid double-printing. One channel, no set.
    const { sink, lines } = capture();
    await consoleReporter(sink).onRunEnd(result);
    const count = lines.join("\n").split("[error] layer-dependencies:").length - 1;
    expect(count).toBe(1);
  });

  it("lists every member of a multi-location finding instead of naming one", async () => {
    // A cycle's members used to survive only as prose inside the message; now they are
    // locations, and the reporter can render them as such.
    const cycle: Violation = {
      ruleName: "no-cycles",
      ruleId: "no-cycles",
      severity: "error",
      message: "Circular dependency among 3 modules",
      fingerprint: "cafe",
      locations: [
        { type: "module", module: "/src/a.ts" },
        { type: "module", module: "/src/b.ts" },
        { type: "module", module: "/src/c.ts" },
      ],
    };
    const { sink, lines } = capture();
    await consoleReporter(sink).onRunEnd({ ...result, violations: [cycle], rules: [] });
    const text = lines.join("\n");
    expect(text).toContain("· a.ts");
    expect(text).toContain("· b.ts");
    expect(text).toContain("· c.ts");
  });
});

describe("json reporter", () => {
  it("emits parseable JSON with violations", async () => {
    const { sink, lines } = capture();
    await jsonReporter(sink).onRunEnd(result);
    const doc = JSON.parse(lines.join("\n"));
    expect(doc.violations).toHaveLength(1);
    expect(doc.violations[0].ruleName).toBe("layer-dependencies");
    expect(doc.diagnostics[0].code).toBe("rule-skipped");
  });

  it("relativizes paths so the document is machine-independent", async () => {
    const { sink, lines } = capture();
    await jsonReporter(sink).onRunEnd(result);
    const doc = JSON.parse(lines.join("\n"));
    const location = doc.violations[0].locations[0];
    expect(location.type).toBe("edge");
    expect(location.edge.from).toBe("widgets/w.ts");
    expect(location.edge.to).toBe("features/auth/model/store.ts");
    expect(location.edge.loc.file).toBe("widgets/w.ts");
  });

  it("carries messageId and data, so a consumer need not parse English", async () => {
    const { sink, lines } = capture();
    await jsonReporter(sink).onRunEnd(result);
    const doc = JSON.parse(lines.join("\n"));
    expect(doc.violations[0].messageId).toBe("higherLayer");
    expect(doc.violations[0].data).toEqual({ fromLayer: "widgets", toLayer: "features" });
  });
});

describe("sarif reporter", () => {
  it("emits SARIF 2.1.0 with ruleId/level/location", async () => {
    const { sink, lines } = capture();
    await sarifReporter(sink).onRunEnd(result);
    const doc = JSON.parse(lines.join("\n"));
    expect(doc.version).toBe("2.1.0");
    expect(doc.runs[0].tool.driver.name).toBe("archwall");
    const res = doc.runs[0].results[0];
    expect(res.ruleId).toBe("layer-dependencies");
    expect(res.level).toBe("error");
    expect(res.locations[0].physicalLocation.region.startLine).toBe(3);
  });

  it("emits a root-relative artifact URI, which GitHub code scanning requires", async () => {
    const { sink, lines } = capture();
    await sarifReporter(sink).onRunEnd(result);
    const doc = JSON.parse(lines.join("\n"));
    const uri = doc.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri;
    // An absolute path here is silently useless: GitHub cannot associate the result with a
    // file in the repository.
    expect(uri).toBe("widgets/w.ts");
    expect(uri.startsWith("/")).toBe(false);
  });

  it("describes rules from the inventory, including ones that found nothing", async () => {
    const { sink, lines } = capture();
    await sarifReporter(sink).onRunEnd(result);
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
    const { sink, lines } = capture();
    await sarifReporter(sink).onRunEnd(result);
    const invocation = JSON.parse(lines.join("\n")).runs[0].invocations[0];
    expect(invocation.toolExecutionNotifications).toHaveLength(1);
    expect(invocation.toolExecutionNotifications[0].descriptor.id).toBe("rule-skipped");
    expect(invocation.executionSuccessful).toBe(true);
  });

  it("carries the fingerprint so consumers can track a finding across commits", async () => {
    const { sink, lines } = capture();
    await sarifReporter(sink).onRunEnd(result);
    const doc = JSON.parse(lines.join("\n"));
    expect(doc.runs[0].results[0].partialFingerprints.archwall).toBe("deadbeefdeadbeef");
  });
});

describe("resolveReporters", () => {
  it("maps names to built-ins and passes customs through", () => {
    const custom = { name: "x", onRunEnd: () => {} };
    const { io } = captureIO();
    const { reporters } = resolveReporters(["console", "sarif", custom], io);
    expect(reporters.map((r) => r.name)).toEqual(["console", "sarif", "x"]);
    expect(reporters[2]).toBe(custom);
  });

  it("throws on unknown names", () => {
    const { io } = captureIO();
    expect(() => resolveReporters(["nope"], io)).toThrow(/unknown reporter/i);
  });

  it("sends each reporter to its own destination", async () => {
    // The whole point: `--reporter console --reporter sarif --output archwall.sarif` must
    // not put a human summary inside the SARIF document.
    const { io, written } = captureIO();
    const { reporters, close } = resolveReporters(
      ["console", { reporter: "sarif", output: "archwall.sarif" }],
      io,
    );
    for (const r of reporters) await r.onRunEnd(result);
    await close();
    expect(written.has("stdout")).toBe(true);
    expect(written.has("archwall.sarif")).toBe(true);
    // The SARIF destination got exactly one document and nothing else.
    const sarif = written.get("archwall.sarif")!;
    expect(sarif).toHaveLength(1);
    expect(() => JSON.parse(sarif.join("\n"))).not.toThrow();
    expect(written.get("stdout")!.join("\n")).toContain("1 error(s)");
  });
});
