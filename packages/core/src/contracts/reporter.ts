import type { Capability, GraphDelivery, HostInfo } from "../graph/ir.js";
import type { Severity, Violation } from "../violations.js";
import type { Diagnostic } from "./diagnostic.js";

/**
 * Where a reporter's output goes.
 *
 * `"stdout"` and `"stderr"` are the two every environment has; anything else is a file
 * path, which only a host with a filesystem can honour. A reporter never decides this —
 * it writes to the sink it is handed.
 */
export type OutputDestination = "stdout" | "stderr" | (string & {});

export interface OutputSink {
  write(text: string): void;
  /** Flushed and awaited before the run's result is acted on. */
  close?(): void | Promise<void>;
}

/**
 * Opens destinations. The seam that lets the same built-in reporter write to a terminal,
 * to stderr, or to `archwall.sarif` without knowing which.
 *
 * Per-reporter, so that a machine-readable document and a human summary in the same run
 * never share a stream.
 */
export interface ReporterIO {
  open(destination: OutputDestination): OutputSink;
}

export interface RunInfo {
  /**
   * Unique per analysis. In watch mode one reporter instance may see many runs, and
   * without a way to tell them apart any per-run state it keeps grows forever. A custom
   * reporter that accumulates anything should key it on this and drop the previous run's.
   */
  runId: string;
  host: HostInfo;
  startedAt: number;
  /** Absolute repository root, so a reporter can relativize before its first output. */
  repoRoot: string;
}

export interface AnalysisStats {
  moduleCount: number;
  edgeCount: number;
  durationMs: number;
}

/**
 * What happened to one configured rule instance in this run.
 *
 * Without it there is no way to answer "did my rule actually run?" — the question behind
 * every report of the tool being silently wrong. It is also what lets a reporter emit rule
 * metadata for rules that produced no violations, which SARIF's `tool.driver.rules` wants.
 */
export interface RuleRunInfo {
  /** Instance id — what `overrides` matches and what violations report. */
  id: string;
  name: string;
  description: string;
  docsUrl?: string;
  severity: Severity;
  /**
   * `ran` — checked, whether or not it found anything.
   * `skipped` — the host could not provide capabilities it requires.
   * `failed` — it threw; see the matching `rule-failed` diagnostic.
   *
   * Rules dropped for invalid options or invalid configuration never reach the engine and
   * so are absent here; they appear as diagnostics.
   */
  status: "ran" | "skipped" | "failed";
  /** Violations this instance produced. */
  violations: number;
  durationMs: number;
  /** Present when `status: "skipped"`. */
  missingCapabilities?: readonly Capability[];
  /** Present when the rule is deprecated; mirrors the `rule-deprecated` diagnostic. */
  deprecated?: boolean;
}

export interface AnalysisResult {
  /** Deterministically ordered; see `compareViolations`. */
  violations: readonly Violation[];
  /** Everything that is not a violation: skipped rules, crashed rules, config problems. */
  diagnostics: readonly Diagnostic[];
  stats: AnalysisStats;
  /** Every rule instance the engine saw, in configuration order. */
  rules: readonly RuleRunInfo[];
  host: HostInfo;
  delivery: GraphDelivery;
  /**
   * Absolute repository root. Reporters need it to emit repo-relative paths, and without
   * it correct SARIF is impossible: `artifactLocation.uri` must be repo-relative or GitHub
   * code scanning cannot associate a result with a file.
   */
  repoRoot: string;
}

/**
 * Two hooks, both batch. There is deliberately no per-violation streaming hook
 */
export interface Reporter {
  name: string;
  /**
   * Called before the engine runs. The place to reset per-run state, which matters because
   * one reporter instance can outlive many runs in watch mode.
   */
  onRunStart?(info: RunInfo): void | Promise<void>;
  /** Awaited, so a reporter may write a file or flush a socket. */
  onRunEnd(result: AnalysisResult): void | Promise<void>;
}

export function defineReporter(reporter: Reporter): Reporter {
  return reporter;
}
