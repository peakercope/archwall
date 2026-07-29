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
import { loadConfig, materializeConfig } from "./load-config.js";
import { nodeIO } from "./node-io.js";

export interface CreateRunOptions {
  host: HostInfo;
  /** Inline config wins over the discovered file when both are given. */
  config?: UserConfig;
  configPath?: string;
  cwd?: string;
  /** Forwarded to reporters. Defaults to a filesystem-capable IO rooted at `cwd`. */
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

/**
 * Diagnostic codes grouped by the `failOnDiagnostics` switch that governs them.
 *
 * NOTE: a new gate has to be added in three places — here, in `DEFAULT_GATES` below, and in
 * `resolveConfig`'s defaults in `@archwall/core`. Nothing links them at compile time beyond
 * `keyof ResolvedFailOnDiagnostics`, which catches a missing key here but not a missing
 * default. Consolidating them is surface work that belongs with the M3 freeze.
 */
const DIAGNOSTIC_GATES: Record<keyof ResolvedFailOnDiagnostics, readonly string[]> = {
  ruleFailed: ["rule-failed"],
  ruleSkipped: ["rule-skipped"],
  emptyAnalysis: ["no-modules-classified", "empty-project"],
  emptyScope: ["empty-scope"],
  invalidOptions: ["invalid-rule-options"],
  invalidConfig: ["invalid-config"],
  deprecated: ["rule-deprecated"],
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
  /**
   * Engine → reporters (onRunStart, onRunEnd) → failed/summary.
   *
   * Named `check`, not `analyze`: `analyze` is the pure engine entry point in `@archwall/core`
   * and this is the impure edge around it — it opens sinks, drives reporters, and decides
   * pass/fail. One word for both was the reason nobody could tell which one a call site meant.
   */
  check(graph: ProjectGraph): Promise<RunResult>;
}

const DEFAULT_GATES: ResolvedFailOnDiagnostics = {
  ruleFailed: true,
  ruleSkipped: false,
  emptyAnalysis: false,
  emptyScope: false,
  invalidOptions: true,
  invalidConfig: true,
  deprecated: false,
};

/**
 * The single definition of pass/fail and of the one-line summary. Two implementations of
 * one policy is how an exit code and its printed output drift apart, so there is one.
 */
export function summarize(
  result: AnalysisResult,
  failOn: ResolvedConfig["failOn"],
  failOnDiagnostics: ResolvedFailOnDiagnostics = DEFAULT_GATES,
): Omit<RunResult, "result"> {
  const { error, warn, info } = countBySeverity(result.violations);
  const byViolation = failOn === "never" ? false : failOn === "warn" ? error + warn > 0 : error > 0;

  // Diagnostics are a separate gate, not a severity tier of violations. Without this a rule
  // that threw passed green in CI — the worst possible outcome for an enforcement tool.
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
    // An inline config gets the same `extends` and named-plugin treatment a file does —
    // otherwise `extends` would work in `archwall.config.ts` and silently not in
    // `archwall({ config: { extends: … } })`, which is the same config either way.
    userConfig = await materializeConfig(opts.config, { cwd });
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
      ? { ...resolved, transforms: [...resolved.transforms, ...opts.transforms] }
      : resolved;
  const io = opts.io ?? nodeIO(cwd);
  let runCounter = 0;

  return {
    config,
    configFile,
    graphBuilder(delivery) {
      return new GraphBuilder({
        host: opts.host,
        // From the resolved config, never guessed: it is the base every `file:` id is relative
        // to, so a different value here means different violation fingerprints.
        repoRoot: config.repoRoot,
        ...(delivery !== undefined ? { delivery } : {}),
      });
    },
    async check(graph) {
      const startedAt = Date.now();
      const runId = `${startedAt}-${++runCounter}`;
      // Built-ins are constructed PER RUN. The run object is memoized across watch rebuilds
      // in the bundler adapters, so a reporter built once here outlives every rebuild — and
      // any per-run state it holds accumulates for the life of the process. Reporters the
      // user passed as objects are theirs; they get `runId` instead.
      const { reporters, close } = resolveReporters(config.reporterSpecs, io);
      try {
        for (const r of reporters) {
          await r.onRunStart?.({ runId, host: graph.host, startedAt, repoRoot: config.repoRoot });
        }
        const result = await analyze(graph, config);
        // Awaited: a reporter that writes a file or flushes a socket must complete before
        // the caller acts on the result (the CLI sets an exit code immediately after).
        for (const r of reporters) await r.onRunEnd(result);
        return { result, ...summarize(result, config.failOn, config.failOnDiagnostics) };
      } finally {
        // In `finally` so a reporter that throws still leaves complete files behind rather
        // than truncated ones.
        await close();
      }
    },
  };
}
