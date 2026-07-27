import type {
  AnalysisResult,
  Diagnostic,
  GraphDelivery,
  GraphTransform,
  HostInfo,
  ProjectGraph,
  ReporterIO,
  ResolvedConfig,
  ResolvedFailOnDiagnostics,
  UserConfig,
} from "@archwall/core";
import { analyze, countBySeverity, resolveConfig, resolveReporters } from "@archwall/core";
import { GraphBuilder } from "./graph-builder.js";
import { loadConfig } from "./load-config.js";

export interface CreateRunOptions {
  host: HostInfo;
  /** Inline config wins over the discovered file when both are given. */
  config?: UserConfig;
  configPath?: string;
  cwd?: string;
  /** Forwarded to built-in reporters. */
  io?: ReporterIO;
  /**
   * Transforms the HOST contributes, appended after the config's own.
   *
   * The seam for host-specific graph facts that are policy rather than extraction — Vite
   * dev opting into `dropSelfEdges()` because its HMR instrumentation invents them, for
   * instance. Keeping that in the adapter meant the next host with HMR would reimplement
   * it, and the two could then disagree.
   */
  transforms?: GraphTransform[];
}

export interface RunResult {
  result: AnalysisResult;
  /**
   * Per `failOn` over violations ("error" → any error; "warn" → any error or warning;
   * "never" → never), OR per `failOnDiagnostics` over diagnostics — a crashed rule fails
   * the run by default even when it produced no violations at all.
   */
  failed: boolean;
  summary: string;
}

/** Diagnostic codes grouped by the `failOnDiagnostics` switch that governs them. */
const DIAGNOSTIC_GATES: Record<keyof ResolvedFailOnDiagnostics, readonly string[]> = {
  ruleFailed: ["rule-failed"],
  ruleSkipped: ["rule-skipped"],
  emptyAnalysis: ["no-modules-classified", "empty-project"],
  invalidOptions: ["invalid-rule-options"],
};

function failingDiagnostics(
  result: AnalysisResult,
  gates: ResolvedFailOnDiagnostics,
): readonly Diagnostic[] {
  const codes = new Set(
    (Object.keys(DIAGNOSTIC_GATES) as (keyof ResolvedFailOnDiagnostics)[])
      .filter((k) => gates[k])
      .flatMap((k) => DIAGNOSTIC_GATES[k]),
  );
  return result.diagnostics.filter((d) => codes.has(d.code));
}

export interface ArchWallRun {
  config: ResolvedConfig;
  configFile: string | null;
  graphBuilder(delivery?: GraphDelivery): GraphBuilder;
  /** Engine → reporters (onRunStart, onViolation, onRunEnd) → failed/summary. */
  analyze(graph: ProjectGraph): Promise<RunResult>;
}

/**
 * The single definition of pass/fail and of the one-line summary. Both used to be
 * computed here *and* independently in the console reporter, with different wording —
 * two implementations of one policy is how the CLI's exit code and its printed output
 * drift apart.
 */
export function summarize(
  result: AnalysisResult,
  failOn: ResolvedConfig["failOn"],
  failOnDiagnostics: ResolvedFailOnDiagnostics = {
    ruleFailed: true,
    ruleSkipped: false,
    emptyAnalysis: false,
    invalidOptions: true,
  },
): Omit<RunResult, "result"> {
  const { error, warn, info } = countBySeverity(result.violations);
  const byViolation = failOn === "never" ? false : failOn === "warn" ? error + warn > 0 : error > 0;

  // Diagnostics are a separate gate, not a severity tier of violations. This used to be
  // missing entirely: `rule-failed` was `severity: "error"` and yet counted for nothing,
  // so a rule that threw in CI passed green — the worst possible outcome for a tool whose
  // whole job is enforcement.
  const blocking = failingDiagnostics(result, failOnDiagnostics);

  const parts = [`${error} error(s)`, `${warn} warning(s)`];
  if (info > 0) parts.push(`${info} info`);
  if (blocking.length > 0) parts.push(`${blocking.length} blocking diagnostic(s)`);

  return {
    failed: byViolation || blocking.length > 0,
    summary: `archwall: ${parts.join(", ")} (${result.stats.moduleCount} modules, ${result.stats.edgeCount} edges)`,
  };
}

export async function createArchWallRun(opts: CreateRunOptions): Promise<ArchWallRun> {
  const cwd = opts.cwd ?? process.cwd();
  let userConfig: UserConfig;
  let configFile: string | null = null;
  if (opts.config !== undefined) {
    userConfig = opts.config;
  } else {
    const loaded = await loadConfig({
      cwd,
      ...(opts.configPath !== undefined ? { configPath: opts.configPath } : {}),
    });
    userConfig = loaded.config;
    configFile = loaded.configFile;
  }
  const resolved = resolveConfig(userConfig, { cwd });
  const config: ResolvedConfig =
    opts.transforms !== undefined && opts.transforms.length > 0
      ? {
          ...resolved,
          transforms: [...resolved.transforms, ...opts.transforms],
        }
      : resolved;
  let runCounter = 0;

  return {
    config,
    configFile,
    graphBuilder(delivery) {
      return new GraphBuilder({
        host: opts.host,
        ...(delivery !== undefined ? { delivery } : {}),
      });
    },
    async analyze(graph) {
      const startedAt = Date.now();
      const runId = `${startedAt}-${++runCounter}`;
      // Built-ins are constructed PER RUN. The run object is memoized across watch
      // rebuilds in both bundler adapters, so a reporter built once here outlives every
      // rebuild — and any per-run state it holds accumulates for the life of the process.
      // Reporters the user passed as objects are theirs; they get `runId` instead.
      const reporters = resolveReporters(config.reporterSpecs, opts.io);
      for (const r of reporters) {
        await r.onRunStart?.({
          runId,
          host: graph.host,
          startedAt,
          repoRoot: config.repoRoot,
        });
      }
      const result = await analyze(graph, config);
      for (const r of reporters) {
        if (r.onViolation) for (const v of result.violations) await r.onViolation(v);
      }
      // Awaited: a reporter that writes a file or flushes a socket must complete before
      // the caller acts on the result (the CLI sets an exit code immediately after).
      for (const r of reporters) await r.onRunEnd(result);
      return {
        result,
        ...summarize(result, config.failOn, config.failOnDiagnostics),
      };
    },
  };
}
