import * as path from "node:path";
import { GraphComputationCache } from "../analysis/cache.js";
import type { ResolvedConfig } from "../config.js";
import type { Diagnostic } from "../contracts/diagnostic.js";
import type { AnalysisResult, RuleRunInfo } from "../contracts/reporter.js";
import type { RuleContext, RuleScope } from "../contracts/rule.js";
import type { Capability, ModuleId, ProjectGraph } from "../graph/ir.js";
import { assertIrCompatible } from "../graph/ir.js";
import { GraphQuery } from "../graph/query.js";
import { matchesPattern } from "../match.js";
import type { Severity, Violation } from "../violations.js";
import { compareViolations, fingerprintOf } from "../violations.js";
import { applyProjectBoundary } from "./boundary.js";
import { applyClassifiers } from "./classify.js";
import { prepareGraph } from "./prepare.js";

/**
 * The engine: bound the project, classify, then check. Pure — no I/O, no reporter calls;
 * reporters are driven by the run edge (integration-kit).
 */
export async function analyze(
  graph: ProjectGraph,
  config: ResolvedConfig,
): Promise<AnalysisResult> {
  const started = performance.now();
  assertIrCompatible(graph.irVersion);

  const configDiagnostics: Diagnostic[] = [...config.diagnostics];

  const effective = new Set<Capability>(graph.host.capabilities);
  // In progressive delivery the absence of a module is not evidence; completeness-
  // dependent rules must not run even if the host is capable in principle.
  if (graph.delivery === "progressive") effective.delete("complete-graph");

  // Transforms run between the boundary and classification: after the project's shape is
  // known, before anything is tagged, so what they add is classified like everything else.
  //
  // The boundary therefore still runs on its own here. Fusing it with classification (see
  // `prepareGraph`) would put transforms on the wrong side of one or the other, so the
  // fused pass is used only when there is nothing to run in between — which is the common
  // case and the one the allocation budget is about.
  let transformed = config.transforms.length === 0 ? graph : applyProjectBoundary(graph, config);
  for (const t of config.transforms) {
    try {
      transformed = t.transform(transformed, {
        sourceRoot: config.sourceRoot,
        repoRoot: config.repoRoot,
      });
      for (const c of t.provides ?? []) effective.add(c);
    } catch (err) {
      // Same isolation a rule gets, for the same reason: one broken enricher must not
      // destroy the run. Its capabilities are NOT added, so rules depending on them skip
      // loudly rather than running against a graph that never got enriched.
      configDiagnostics.push({
        code: "transform-failed",
        severity: "error",
        message: `Graph transform "${t.name}" threw and was skipped: ${err instanceof Error ? err.message : String(err)}`,
        ...(err instanceof Error && err.stack !== undefined
          ? { details: { stack: err.stack } }
          : {}),
      });
    }
  }

  const classifierCtx = { sourceRoot: config.sourceRoot };
  const classified =
    config.transforms.length === 0
      ? // One pass over the modules instead of two, and no copy at all for a module that
        // neither the boundary re-kinded nor a classifier tagged.
        prepareGraph(transformed, config, config.classifiers, classifierCtx)
      : applyClassifiers(transformed, config.classifiers, classifierCtx);
  const query = new GraphQuery(classified);
  const cache = new GraphComputationCache(query);

  // One scoped view per DISTINCT scope, not per rule: "FSD under apps/web" is typically
  // the scope of several rules at once, and they can share the computation.
  const scopedQueries = new Map<string, GraphQuery>();
  const queryFor = (scope: RuleScope | undefined): GraphQuery => {
    if (scope === undefined) return query;
    const key = JSON.stringify([scope.include ?? null, scope.exclude ?? null, scope.tag ?? null]);
    let scoped = scopedQueries.get(key);
    if (!scoped) {
      scoped = new GraphQuery(classified, modulesInScope(classified, scope, config.sourceRoot));
      scopedQueries.set(key, scoped);
    }
    return scoped;
  };

  const violations: Violation[] = [];
  // Config-time findings come first: they explain why a rule you configured is missing
  // from this run at all.
  const diagnostics: Diagnostic[] = configDiagnostics;

  const inventory: RuleRunInfo[] = [];
  const describe = (
    rule: (typeof config.rules)[number]["rule"],
    id: string,
    severity: Severity,
  ): Omit<RuleRunInfo, "status" | "violations" | "durationMs"> => ({
    id,
    name: rule.meta.name,
    description: rule.meta.description,
    ...(rule.meta.docsUrl !== undefined ? { docsUrl: rule.meta.docsUrl } : {}),
    severity,
  });

  for (const { rule, id, options, severity, scope } of config.rules) {
    const missing = (rule.meta.requiredCapabilities ?? []).filter((c) => !effective.has(c));
    if (missing.length > 0) {
      diagnostics.push({
        code: "rule-skipped",
        severity: "warn",
        ruleId: id,
        message: `Rule "${rule.meta.name}" needs capabilities [${missing.join(", ")}] that host "${graph.host.name}" cannot provide in this mode; the rule was skipped. Run via a host with these capabilities for full coverage.`,
        details: { missingCapabilities: missing, host: graph.host.name },
      });
      inventory.push({
        ...describe(rule, id, severity),
        status: "skipped",
        violations: 0,
        durationMs: 0,
        missingCapabilities: missing,
      });
      continue;
    }

    const ctx: RuleContext<unknown> = {
      // Already validated (and possibly transformed) by `resolveConfig`.
      options,
      // Scoping happens HERE, once, for every rule that will ever exist — rather than as
      // a `within` option each rule has to remember to implement.
      graph: queryFor(scope),
      sourceRoot: config.sourceRoot,
      repoRoot: config.repoRoot,
      compute: (c) => cache.get(c),
      report: (v) => {
        // `identity` shapes the fingerprint and is not itself a property of the finding.
        const { identity: _identity, ...rest } = v;
        violations.push({
          ruleName: rule.meta.name,
          ruleId: id,
          ...rest,
          // A rule may grade an individual finding; the configured severity is the default.
          severity: v.severity ?? severity,
          // Repo root, not source root: a fingerprint must survive someone reconfiguring
          // `sourceRoot`, and it is compared across machines and hosts.
          fingerprint: fingerprintOf(config.repoRoot, id, v),
        });
      },
    };

    // One broken rule must not destroy the other thirty-nine results. A third-party rule
    // throwing is a bug report, not a reason to fail the whole run with a stack trace and
    // no indication of which rule was at fault.
    const before = violations.length;
    const startedRule = performance.now();
    let status: RuleRunInfo["status"] = "ran";
    try {
      await rule.check(ctx);
    } catch (err) {
      status = "failed";
      diagnostics.push({
        code: "rule-failed",
        severity: "error",
        ruleId: id,
        message: `Rule "${id}" threw and produced no results: ${err instanceof Error ? err.message : String(err)}`,
        ...(err instanceof Error && err.stack !== undefined
          ? { details: { stack: err.stack } }
          : {}),
      });
    }
    inventory.push({
      ...describe(rule, id, severity),
      status,
      violations: violations.length - before,
      durationMs: performance.now() - startedRule,
    });
  }

  diagnostics.push(...auditClassification(classified));

  return {
    // Deterministic order: baselines, CI diffing, and snapshot tests all need two runs
    // of the same analysis to be byte-identical.
    violations: violations.sort(compareViolations),
    diagnostics,
    rules: inventory,
    repoRoot: config.repoRoot,
    host: graph.host,
    delivery: graph.delivery,
    stats: {
      moduleCount: classified.modules.size,
      edgeCount: classified.edges.length,
      durationMs: performance.now() - started,
    },
  };
}

/**
 * Resolves a {@link RuleScope} to the concrete set of modules a scoped rule is about.
 *
 * Path patterns are matched source-root-relative — the same base `include`/`exclude` and
 * classifier patterns use, so one mental model covers all of them. A module with no file
 * (a builtin, a virtual module) can never be *in* a path scope, but it remains reachable
 * as an edge target, which is where a scoped rule actually needs to see it.
 */
function modulesInScope(graph: ProjectGraph, scope: RuleScope, sourceRoot: string): Set<ModuleId> {
  const ids = new Set<ModuleId>();
  for (const m of graph.modules.values()) {
    if (scope.tag !== undefined) {
      const ok = Object.entries(scope.tag).every(([k, v]) => m.tags.get(k) === v);
      if (!ok) continue;
    }
    if (scope.include !== undefined || scope.exclude !== undefined) {
      if (m.file === null) continue;
      const rel = path.relative(sourceRoot, m.file.replaceAll("\\", "/")).replaceAll("\\", "/");
      if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) continue;
      if (scope.include !== undefined && !scope.include.some((p) => matchesPattern(rel, p)))
        continue;
      if (scope.exclude !== undefined && scope.exclude.some((p) => matchesPattern(rel, p)))
        continue;
    }
    ids.add(m.id);
  }
  return ids;
}

/**
 * The tool's most dangerous property is that its failure mode is *silence*: every rule
 * ignores modules it cannot classify, so a misconfigured `sourceRoot` tags nothing, matches
 * nothing, reports nothing, and passes. These diagnostics are the difference between
 * "your architecture is clean" and "ArchWall never looked at your code".
 */
function auditClassification(graph: ProjectGraph): Diagnostic[] {
  let source = 0;
  let tagged = 0;
  for (const m of graph.modules.values()) {
    if (m.kind !== "source") continue;
    source++;
    if (m.tags.size > 0) tagged++;
  }

  if (source === 0) {
    return [
      {
        code: "empty-project",
        severity: "warn",
        message:
          "No source modules were analysed — every module was external or filtered out by the project boundary. Check `sourceRoot`, `include`, and `exclude`.",
        details: { sourceModules: 0 },
      },
    ];
  }
  if (tagged === 0) {
    return [
      {
        code: "no-modules-classified",
        severity: "warn",
        message: `0 of ${source} source modules were classified, so every tag-based rule matched nothing and this run cannot have found anything. This almost always means \`sourceRoot\` points somewhere other than your source tree, or that no classifier or preset is configured.`,
        details: { sourceModules: source, classifiedModules: 0 },
      },
    ];
  }
  return [];
}
