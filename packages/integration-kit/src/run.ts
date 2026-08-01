import * as path from "node:path";
import type {
  AnalysisResult,
  BaselineInvalidDetails,
  BaselineStaleDetails,
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
import {
  analyze,
  applyBaseline,
  countBySeverity,
  failingDiagnosticCodes,
  resolveConfig,
  resolveFailOnDiagnostics,
  resolveReporters,
  serializeBaseline,
} from "@archwall/core";
import { type ReadBaselineResult, readBaseline, writeBaseline } from "./baseline-file.js";
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
  /** Absolute path written, when `RunCheckOptions.updateBaseline` was set. */
  baselineWritten?: string;
}

function failingDiagnostics(
  result: AnalysisResult,
  gates: ResolvedFailOnDiagnostics,
): readonly Diagnostic[] {
  const codes = failingDiagnosticCodes(gates);
  return result.diagnostics.filter((d) => codes.has(d.code));
}

/** Per-check knobs. Mirrors core's `AnalyzeOptions`, plus what only the run edge can carry. */
export interface RunCheckOptions {
  /**
   * Diagnostics the PRODUCER discovered while building the graph.
   *
   * Passed per check rather than folded into `config.diagnostics`, because the run — and
   * therefore its config — is memoized across watch rebuilds: appending there would
   * accumulate a duplicate on every rebuild for the life of the process.
   *
   * The channel exists because only a producer that enumerates a tree can find some problems
   * at all — the CLI's `unscannable-files` being the motivating case — and a producer with
   * nowhere to report has no choice but to stay silent.
   */
  diagnostics?: readonly Diagnostic[];
  /** Forwarded to `analyze`; aborts the run between rules. */
  signal?: AbortSignal;
  /**
   * Rewrite `config.baseline` from this run's findings, accepting all of them.
   *
   * Changes three things: an absent file stops being a `baseline-invalid` diagnostic (creating
   * it is the point), nothing is reported stale (the file is being replaced), and `failed`
   * comes from diagnostics ALONE — a command whose job is to accept the current violations
   * cannot also fail because they exist.
   *
   * Diagnostics still gate it. A run where a rule crashed saw less than the whole picture, and
   * freezing that into a baseline is how a real violation gets accepted without anyone seeing it.
   */
  updateBaseline?: boolean;
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
  check(graph: ProjectGraph, options?: RunCheckOptions): Promise<RunResult>;
}

/** Core's own defaults, so a caller that passes no gates gets what `resolveConfig` would. */
const DEFAULT_GATES: ResolvedFailOnDiagnostics = resolveFailOnDiagnostics(undefined);

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
  // Never omitted when non-zero. The exit code says nothing about accepted debt, so the one
  // line a CI log keeps has to.
  if (result.suppressed.length > 0) parts.push(`${result.suppressed.length} suppressed`);
  if (blocking.length > 0) parts.push(`${blocking.length} blocking diagnostic(s)`);

  return {
    failed: byViolation || blocking.length > 0,
    summary: `archwall: ${parts.join(", ")} (${result.stats.moduleCount} modules, ${result.stats.edgeCount} edges)`,
  };
}

/**
 * Whether an unmatched baseline entry is evidence that the finding is GONE.
 *
 * Only when the run looked everywhere. A progressive graph is by definition partial, and a
 * rule that was skipped for missing capabilities or that threw produced nothing — so its
 * baseline entries go unmatched for a reason that has nothing to do with the code being fixed.
 * Reporting those as stale would invite pruning entries that are still live, which turns the
 * baseline from accepted debt into silently deleted enforcement.
 */
function staleIsMeaningful(result: AnalysisResult): boolean {
  return result.delivery === "complete" && result.rules.every((r) => r.status === "ran");
}

/** `baseline-invalid` for a file that is configured and unusable. */
function invalidBaselineDiagnostic(repoRoot: string, file: string, reason: string): Diagnostic {
  const rel = path.relative(repoRoot, file) || file;
  // `satisfies`, not an annotation: an interface has no implicit index signature, so a
  // variable typed as one is not assignable to `Diagnostic.details`. This checks the shape and
  // keeps the inferred type, which is.
  const details = { path: rel, reason } satisfies BaselineInvalidDetails;
  return {
    code: "baseline-invalid",
    severity: "error",
    message:
      `Baseline "${rel}" could not be used: ${reason} Nothing was suppressed, so every ` +
      "previously accepted finding is being reported as new.",
    details,
  };
}

/** `baseline-stale` for entries this run did not reproduce. */
function staleBaselineDiagnostic(
  repoRoot: string,
  file: string,
  stale: readonly string[],
): Diagnostic {
  const rel = path.relative(repoRoot, file) || file;
  const details = {
    count: stale.length,
    fingerprints: stale,
  } satisfies BaselineStaleDetails;
  return {
    code: "baseline-stale",
    severity: "warn",
    message:
      `Baseline "${rel}" has ${stale.length} entr${stale.length === 1 ? "y" : "ies"} this run ` +
      "did not produce — the finding was fixed, or the code it was about is gone. Prune with " +
      "`archwall check --update-baseline`; until then a stale entry will silently re-suppress " +
      "its finding if it comes back.",
    details,
  };
}

/**
 * Applies a loaded baseline to a finished analysis.
 *
 * Deliberately here and not in `analyze`: suppression is policy, exactly like `failOn`, and an
 * engine that filtered its own output would make `result.violations` mean different things to
 * different callers.
 */
function suppress(
  result: AnalysisResult,
  baselinePath: string,
  read: ReadBaselineResult,
  updating: boolean,
): AnalysisResult {
  if ("error" in read) {
    if (updating) return result;
    return {
      ...result,
      diagnostics: [
        ...result.diagnostics,
        invalidBaselineDiagnostic(result.repoRoot, baselinePath, read.error),
      ],
    };
  }
  if ("missing" in read) {
    // Expected on the run that creates the file; a configuration error on every other one.
    if (updating) return result;
    return {
      ...result,
      diagnostics: [
        ...result.diagnostics,
        invalidBaselineDiagnostic(
          result.repoRoot,
          baselinePath,
          "the file does not exist. Create it with `archwall check --update-baseline`, or remove `baseline` from your config.",
        ),
      ],
    };
  }

  const applied = applyBaseline(result.violations, read.file);
  const next: AnalysisResult = {
    ...result,
    violations: applied.violations,
    suppressed: applied.suppressed,
  };
  // Not while updating: the file is about to be replaced, so "stale" is a comment on bytes
  // that will not exist by the time anyone reads it.
  if (!updating && applied.stale.length > 0 && staleIsMeaningful(next)) {
    return {
      ...next,
      diagnostics: [
        ...next.diagnostics,
        staleBaselineDiagnostic(next.repoRoot, baselinePath, applied.stale),
      ],
    };
  }
  return next;
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
  // Read ONCE, here, not per check. The run object is memoized across watch rebuilds in every
  // bundler adapter, so a per-check read would stat and parse the file on every keystroke. The
  // cost is that editing a baseline needs a restart — the same deal `archwall.config.ts`
  // already offers, and for the same reason.
  const baseline: ReadBaselineResult | null =
    config.baseline === null ? null : readBaseline(config.baseline);

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
    async check(graph, checkOptions) {
      const startedAt = Date.now();
      const runId = `${startedAt}-${++runCounter}`;
      const extra = checkOptions?.diagnostics ?? [];
      // A fresh config per check when there are producer diagnostics — never a mutation of the
      // memoized one, which every subsequent rebuild would then inherit.
      const effective: ResolvedConfig =
        extra.length > 0 ? { ...config, diagnostics: [...config.diagnostics, ...extra] } : config;
      // Built-ins are constructed PER RUN. The run object is memoized across watch rebuilds
      // in the bundler adapters, so a reporter built once here outlives every rebuild — and
      // any per-run state it holds accumulates for the life of the process. Reporters the
      // user passed as objects are theirs; they get `runId` instead.
      const { reporters, close } = resolveReporters(config.reporterSpecs, io);
      try {
        for (const r of reporters) {
          await r.onRunStart?.({ runId, host: graph.host, startedAt, repoRoot: config.repoRoot });
        }
        const analyzed = await analyze(
          graph,
          effective,
          checkOptions?.signal !== undefined ? { signal: checkOptions.signal } : {},
        );
        const updating = checkOptions?.updateBaseline === true;
        // Reporters see the PARTITIONED result, never the raw one — a reporter that had to
        // remember to filter would eventually forget, and the failure would be an enforcement
        // tool counting findings the user already accepted.
        const result =
          config.baseline !== null && baseline !== null
            ? suppress(analyzed, config.baseline, baseline, updating)
            : analyzed;

        let baselineWritten: string | undefined;
        if (updating && config.baseline !== null) {
          // The TOTAL the run found, not the un-suppressed remainder: rewriting from
          // `violations` alone would drop every entry the old file already accepted and
          // quietly un-suppress it on the next run.
          writeBaseline(
            config.baseline,
            serializeBaseline([...result.violations, ...result.suppressed], result.repoRoot),
          );
          baselineWritten = config.baseline;
        }

        // Awaited: a reporter that writes a file or flushes a socket must complete before
        // the caller acts on the result (the CLI sets an exit code immediately after).
        for (const r of reporters) await r.onRunEnd(result);
        const outcome = summarize(result, config.failOn, config.failOnDiagnostics);
        return {
          result,
          ...outcome,
          // Accepting the current findings is the command's job, so they cannot also fail it.
          // Diagnostics still can: see `RunCheckOptions.updateBaseline`.
          ...(updating
            ? { failed: summarize(result, "never", config.failOnDiagnostics).failed }
            : {}),
          ...(baselineWritten !== undefined ? { baselineWritten } : {}),
        };
      } finally {
        // In `finally` so a reporter that throws still leaves complete files behind rather
        // than truncated ones.
        await close();
      }
    },
  };
}
