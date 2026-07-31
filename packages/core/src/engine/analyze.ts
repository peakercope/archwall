import { GraphComputationCache } from "../analysis/cache.js";
import type { ResolvedConfig, ResolvedRule } from "../config.js";
import type { Diagnostic } from "../contracts/diagnostic.js";
import type { AnalysisResult, RuleRunInfo } from "../contracts/reporter.js";
import type { RuleContext, RuleScope } from "../contracts/rule.js";
import type { Capability, Edge, ModuleId, ModuleNode, ProjectGraph } from "../graph/ir.js";
import { assertIrCompatible, displayModuleId } from "../graph/ir.js";
import { filterKey, GraphQuery } from "../graph/query.js";
import { matchesPattern } from "../match.js";
import { sourceRelative } from "../paths.js";
import type { Severity, Violation } from "../violations.js";
import { compareViolations, fingerprintOf, locationsOf, renderMessage } from "../violations.js";
import { prepareGraph } from "./prepare.js";

/** Per-rule state the dispatcher carries while a run is in flight. */
interface RuleRun {
  resolved: ResolvedRule;
  ctx: RuleContext<unknown>;
  info: RuleRunInfo;
  /**
   * This rule takes no further part in the run. Set for three different reasons — the host
   * lacks a capability it requires, its declaration is invalid, or it threw — which is why
   * it is not the flag that decides whether to keep its violations.
   */
  halted: boolean;
  /**
   * It threw. Separate from {@link halted} because only this one means "whatever it already
   * reported is untrustworthy": a rule that stopped halfway through the edge list reported
   * findings from a partial view of the graph, and the absence of a finding it never got to
   * is not evidence of anything.
   */
  crashed: boolean;
}

/**
 * The engine: prepare the graph (boundary → transforms → classify), then check it.
 *
 * Pure — no I/O, no reporter calls; reporters are driven by the run edge (integration-kit).
 */
export async function analyze(
  graph: ProjectGraph,
  config: ResolvedConfig,
): Promise<AnalysisResult> {
  const started = performance.now();
  assertIrCompatible(graph.irVersion);

  const diagnostics: Diagnostic[] = [...config.diagnostics];

  const effective = new Set<Capability>(graph.host.capabilities);
  // In progressive delivery the absence of a module is not evidence; completeness-dependent
  // rules must not run even if the host is capable in principle.
  if (graph.delivery === "progressive") effective.delete("complete-graph");

  const prepared = prepareGraph(graph, config, config.transforms, config.classifiers);
  const classified = prepared.graph;
  diagnostics.push(...prepared.diagnostics);
  for (const c of prepared.provided) effective.add(c);

  const query = new GraphQuery(classified);
  const cache = new GraphComputationCache();
  const relative = (file: string): string | null => sourceRelative(config.sourceRoot, file);

  // One scoped VIEW per distinct scope — sharing the base query's index, not rebuilding it.
  // "FSD under apps/web" is typically the scope of several rules at once.
  //
  // `size` rides along because resolving a scope is O(modules) and the `empty-scope` audit
  // needs the count for every rule, not once per distinct scope.
  const scopedQueries = new Map<string, { query: GraphQuery; size: number }>();
  const scopeKeyOf = (scope: RuleScope | undefined): string =>
    scope === undefined
      ? "*"
      : JSON.stringify([scope.include ?? null, scope.exclude ?? null, scope.tag ?? null]);
  const queryFor = (
    scope: RuleScope | undefined,
    key: string,
  ): { query: GraphQuery; size: number } => {
    if (scope === undefined) return { query, size: classified.moduleCount };
    let scoped = scopedQueries.get(key);
    if (!scoped) {
      const ids = modulesInScope(classified, scope, config.sourceRoot);
      scoped = { query: query.scoped(ids), size: ids.size };
      scopedQueries.set(key, scoped);
    }
    return scoped;
  };

  const violations: Violation[] = [];
  const runs: RuleRun[] = [];

  for (const resolved of config.rules) {
    const { rule, id, options, severity, scope, message } = resolved;
    const base: Omit<RuleRunInfo, "status" | "violations" | "durationMs"> = {
      id,
      name: rule.meta.name,
      description: rule.meta.description,
      ...(rule.meta.docsUrl !== undefined ? { docsUrl: rule.meta.docsUrl } : {}),
      severity,
      ...(rule.meta.deprecated !== undefined ? { deprecated: true } : {}),
    };

    if (rule.meta.deprecated !== undefined) {
      const d = rule.meta.deprecated;
      diagnostics.push({
        code: "rule-deprecated",
        severity: "warn",
        ruleId: id,
        message:
          `Rule "${rule.meta.name}" is deprecated since ${d.since}` +
          (d.replacedBy !== undefined ? `; use "${d.replacedBy}" instead` : "") +
          (d.reason !== undefined ? `. ${d.reason}` : "."),
        details: {
          since: d.since,
          ...(d.replacedBy !== undefined ? { replacedBy: d.replacedBy } : {}),
        },
      });
    }

    const missing = (rule.meta.requiredCapabilities ?? []).filter((c) => !effective.has(c));
    if (missing.length > 0) {
      diagnostics.push({
        code: "rule-skipped",
        severity: "warn",
        ruleId: id,
        message: `Rule "${rule.meta.name}" needs capabilities [${missing.join(", ")}] that host "${graph.host.name}" cannot provide in this mode; the rule was skipped. Run via a host with these capabilities for full coverage.`,
        details: { missingCapabilities: missing, host: graph.host.name },
      });
      runs.push({
        resolved,
        ctx: null as never,
        info: {
          ...base,
          status: "skipped",
          violations: 0,
          durationMs: 0,
          missingCapabilities: missing,
        },
        halted: true,
        crashed: false,
      });
      continue;
    }

    if (rule.visits === undefined && rule.check === undefined) {
      diagnostics.push({
        code: "invalid-config",
        severity: "error",
        ruleId: id,
        message: `Rule "${rule.meta.name}" declares neither \`visits\` nor \`check\`, so it can never report anything. This is a bug in the rule.`,
      });
      runs.push({
        resolved,
        ctx: null as never,
        info: { ...base, status: "skipped", violations: 0, durationMs: 0 },
        halted: true,
        crashed: false,
      });
      continue;
    }

    const templates = messageTemplates(rule.meta.messages, message);
    const scopeKey = scopeKeyOf(scope);
    // Scoping happens HERE, once, for every rule that will ever exist — rather than as a
    // `within` option each rule has to remember to implement.
    const { query: scopedQuery, size: scopeSize } = queryFor(scope, scopeKey);

    // The silence doctrine, per rule. Global silence was already diagnosed; this closes the
    // hole one level down, where a typo in `scope.include` makes a rule survey nothing,
    // report nothing, and pass green — indistinguishable from a clean architecture. Emitted
    // per RULE rather than inside the memoized `queryFor`, so ten rules sharing one bad scope
    // produce ten diagnostics naming ten rules rather than one naming none of them.
    if (scope !== undefined && scopeSize === 0) {
      diagnostics.push({
        code: "empty-scope",
        severity: "warn",
        ruleId: id,
        message: `Rule "${id}" is scoped to 0 of ${classified.moduleCount} modules, so it cannot report anything. Check \`scope\` — path patterns are matched relative to \`sourceRoot\` ("${config.sourceRoot}"), and \`tag\` requires the module to already be classified.`,
        details: { scope, totalModules: classified.moduleCount },
      });
    }
    const ctx: RuleContext<unknown> = {
      // Already validated (and possibly transformed) by `resolveConfig`.
      options,
      graph: scopedQuery,
      sourceRoot: config.sourceRoot,
      repoRoot: config.repoRoot,
      relative,
      display: displayModuleId,
      // The rule's OWN view, not the root one: a computation enumerates the graph, and enumeration is scoped.
      compute: (c) => cache.get(c, scopedQuery),
      report: (v) => {
        const locations = locationsOf(v);
        const template = v.messageId !== undefined ? templates[v.messageId] : undefined;
        let text: string;
        if (v.message !== undefined) {
          text = v.message;
        } else if (template !== undefined) {
          text = renderMessage(template, v.data);
        } else {
          text = `${rule.meta.name}: ${v.messageId ?? "(no message)"}`;
          diagnostics.push({
            code: "invalid-config",
            severity: "error",
            ruleId: id,
            message: `Rule "${rule.meta.name}" reported messageId "${v.messageId ?? ""}" but no template is defined for it, in either \`meta.messages\` or the instance's \`message\`.`,
          });
        }
        violations.push({
          ruleName: rule.meta.name,
          ruleId: id,
          severity: v.severity ?? severity,
          message: text,
          ...(v.messageId !== undefined ? { messageId: v.messageId } : {}),
          ...(v.data !== undefined ? { data: v.data } : {}),
          locations,
          ...(v.explanation !== undefined ? { explanation: v.explanation } : {}),
          // Repo root, not source root: a fingerprint must survive someone reconfiguring
          // `sourceRoot`, and it is compared across machines and hosts.
          fingerprint: fingerprintOf(config.repoRoot, id, v),
        });
      },
    };

    runs.push({
      resolved,
      ctx,
      info: { ...base, status: "ran", violations: 0, durationMs: 0 },
      halted: false,
      crashed: false,
    });
  }

  const active = runs.filter((r) => !r.halted);
  dispatchVisitors(active, diagnostics, scopeKeyOf);

  // Whole-graph rules run after the traversal, and one at a time: they may be async, and
  // several of them share the memoized computation cache.
  for (const run of active) {
    if (run.halted || run.resolved.rule.check === undefined) continue;
    const startedRule = performance.now();
    try {
      await run.resolved.rule.check(run.ctx);
    } catch (err) {
      markFailed(run, err, diagnostics);
    }
    run.info.durationMs += performance.now() - startedRule;
  }

  // A crashed rule's partial findings are discarded, which is what makes the `rule-failed`
  // diagnostic ("threw and produced no results") true. Keeping them would be worse than
  // useless: they come from a rule that stopped partway through the graph, so the set is
  // neither complete nor known-incomplete to anyone reading it, and a baseline built over it
  // would encode findings that vanish the moment the crash is fixed. Rule instance ids are
  // unique, so matching on `ruleId` is exact.
  //
  // Diagnostics the rule caused on its way down are NOT discarded — an `invalid-config` for a
  // missing message template is a real defect regardless of what happened next.
  const crashed = new Set(runs.filter((r) => r.crashed).map((r) => r.info.id));
  const kept = crashed.size === 0 ? violations : violations.filter((v) => !crashed.has(v.ruleId));

  // Rules interleave inside a shared traversal, so a start/end offset per rule would not
  // attribute correctly; counts come from the violations themselves. Counted over what was
  // KEPT and set for every status, so a failed rule reports 0 because it produced nothing —
  // `result.rules` and `result.violations` cannot disagree.
  const perRule = new Map<string, number>();
  for (const v of kept) perRule.set(v.ruleId, (perRule.get(v.ruleId) ?? 0) + 1);
  for (const run of runs) run.info.violations = perRule.get(run.info.id) ?? 0;

  diagnostics.push(...auditClassification(classified));

  return {
    // Deterministic order: baselines, CI diffing, and snapshot tests all need two runs of
    // the same analysis to be byte-identical.
    violations: kept.sort(compareViolations),
    diagnostics,
    rules: runs.map((r) => r.info),
    repoRoot: config.repoRoot,
    host: graph.host,
    delivery: graph.delivery,
    stats: {
      moduleCount: classified.moduleCount,
      edgeCount: classified.edgeCount,
      durationMs: performance.now() - started,
    },
  };
}

/**
 * Runs every declared-interest rule, one traversal per distinct (scope, filter) pair.
 *
 * The filtered slice is materialized once and shared by every rule that asked for it, which
 * is what makes the cost O(distinct slices + total visits) rather than O(rules × graph).
 * Rules that want the whole edge list with no filter share the graph's own array and copy
 * nothing at all.
 *
 * Isolation is per rule, not per visit: the try/catch wraps a rule's entire pass over the
 * slice, so a rule that throws stops and is marked failed while the other thirty-nine keep
 * their results — without paying for exception handling on every edge.
 */
function dispatchVisitors(
  runs: readonly RuleRun[],
  diagnostics: Diagnostic[],
  scopeKeyOf: (scope: RuleScope | undefined) => string,
): void {
  interface Bucket<T> {
    /** Evaluated once, then shared by every member. */
    slice: () => readonly T[];
    members: { run: RuleRun; visit: (item: T, ctx: RuleContext<unknown>) => void }[];
  }

  const edgeBuckets = new Map<string, Bucket<Edge>>();
  const moduleBuckets = new Map<string, Bucket<ModuleNode>>();

  for (const run of runs) {
    const visits = run.resolved.rule.visits;
    if (visits === undefined) continue;
    const scopeKey = scopeKeyOf(run.resolved.scope);
    const query = run.ctx.graph;

    const edgeSpec = visits.edges;
    if (edgeSpec !== undefined) {
      try {
        const filter = edgeSpec.filter?.(run.ctx.options);
        const key = `${scopeKey}|e|${filterKey(filter)}`;
        let bucket = edgeBuckets.get(key);
        if (bucket === undefined) {
          bucket = { slice: () => query.edges(filter), members: [] };
          edgeBuckets.set(key, bucket);
        }
        bucket.members.push({
          run,
          visit: edgeSpec.visit as (e: Edge, c: RuleContext<unknown>) => void,
        });
      } catch (err) {
        markFailed(run, err, diagnostics);
        continue;
      }
    }

    const moduleSpec = visits.modules;
    if (moduleSpec !== undefined) {
      try {
        const filter = moduleSpec.filter?.(run.ctx.options);
        const key = `${scopeKey}|m|${filterKey(filter)}`;
        let bucket = moduleBuckets.get(key);
        if (bucket === undefined) {
          bucket = { slice: () => query.modules(filter).toArray(), members: [] };
          moduleBuckets.set(key, bucket);
        }
        bucket.members.push({
          run,
          visit: moduleSpec.visit as (m: ModuleNode, c: RuleContext<unknown>) => void,
        });
      } catch (err) {
        markFailed(run, err, diagnostics);
      }
    }
  }

  const drain = <T>(buckets: Map<string, Bucket<T>>): void => {
    for (const bucket of buckets.values()) {
      const items = bucket.slice();
      for (const { run, visit } of bucket.members) {
        if (run.halted) continue;
        const startedRule = performance.now();
        try {
          for (const item of items) visit(item, run.ctx);
        } catch (err) {
          markFailed(run, err, diagnostics);
        }
        run.info.durationMs += performance.now() - startedRule;
      }
    }
  };

  drain(edgeBuckets);
  drain(moduleBuckets);
}

function markFailed(run: RuleRun, err: unknown, diagnostics: Diagnostic[]): void {
  run.halted = true;
  run.crashed = true;
  run.info.status = "failed";
  diagnostics.push({
    code: "rule-failed",
    severity: "error",
    ruleId: run.resolved.id,
    message: `Rule "${run.resolved.id}" threw and produced no results: ${err instanceof Error ? err.message : String(err)}`,
    ...(err instanceof Error && err.stack !== undefined ? { details: { stack: err.stack } } : {}),
  });
}

/**
 * The instance's message templates over the rule's own.
 *
 * A bare string retargets a single-message rule; a record retargets by id. Anything the
 * instance does not mention keeps the rule's wording.
 */
function messageTemplates(
  own: Record<string, string> | undefined,
  override: string | Record<string, string> | undefined,
): Record<string, string> {
  const base = { ...(own ?? {}) };
  if (override === undefined) return base;
  if (typeof override === "string") {
    const ids = Object.keys(base);
    // One message: unambiguous. Several: retarget them all, since the user asked for one
    // sentence and getting it on only an arbitrary one of them would be worse.
    for (const id of ids.length > 0 ? ids : ["default"]) base[id] = override;
    return base;
  }
  return { ...base, ...override };
}

/**
 * Resolves a {@link RuleScope} to the concrete set of modules a scoped rule is about.
 *
 * Path patterns are matched source-root-relative — the same base `include`/`exclude` and
 * classifier patterns use. A module with no file (a builtin, a virtual module) can never be
 * *in* a path scope, but it remains reachable as an edge target, which is where a scoped
 * rule actually needs to see it.
 */
function modulesInScope(graph: ProjectGraph, scope: RuleScope, sourceRoot: string): Set<ModuleId> {
  const ids = new Set<ModuleId>();
  for (const m of graph.modules()) {
    if (scope.tag !== undefined) {
      const ok = Object.entries(scope.tag).every(([k, v]) => m.tags.get(k) === v);
      if (!ok) continue;
    }
    if (scope.include !== undefined || scope.exclude !== undefined) {
      if (m.file === null) continue;
      const rel = sourceRelative(sourceRoot, m.file);
      if (rel === null) continue;
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
 * nothing, reports nothing, and passes. These diagnostics are the difference between "your
 * architecture is clean" and "ArchWall never looked at your code".
 */
function auditClassification(graph: ProjectGraph): Diagnostic[] {
  let source = 0;
  let tagged = 0;
  for (const m of graph.modules()) {
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
