import type { Capability, GraphDelivery, HostInfo } from "../graph/ir.js";
import type { Severity, Violation } from "../violations.js";
import type { Diagnostic } from "./diagnostic.js";

export interface RunInfo {
  /**
   * Unique per analysis. In watch mode one reporter instance may see many runs, and
   * without a way to tell them apart any per-run state it keeps grows forever — which is
   * exactly what happened to the console reporter's dedup set. A custom reporter that
   * accumulates anything should key it on this and drop the previous run's.
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
 * Mandatory once there are dozens of rules and trivial to add now: without it there is no
 * way to answer "did my rule actually run?" — the question behind every report of the tool
 * being silently wrong. It is also what lets a reporter emit rule metadata (`description`,
 * `docsUrl`) for rules that produced no violations, which SARIF's `tool.driver.rules`
 * wants and which the result had no way to supply.
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
   * Rules dropped for invalid options never reach the engine at all and so are absent
   * here; they appear as `invalid-rule-options` diagnostics.
   */
  status: "ran" | "skipped" | "failed";
  /** Violations this instance produced. */
  violations: number;
  durationMs: number;
  /** Present when `status: "skipped"`. */
  missingCapabilities?: readonly Capability[];
}

export interface AnalysisResult {
  /** Deterministically ordered; see `compareViolations`. */
  violations: readonly Violation[];
  /** Everything that is not a violation: skipped rules, crashed rules, config warnings. */
  diagnostics: readonly Diagnostic[];
  stats: AnalysisStats;
  /** Every rule instance the engine saw, in configuration order. */
  rules: readonly RuleRunInfo[];
  host: HostInfo;
  delivery: GraphDelivery;
  /**
   * Absolute repository root. Reporters need it to emit repo-relative paths, and
   * without it correct SARIF is impossible: `artifactLocation.uri` must be
   * repo-relative or GitHub code scanning cannot associate a result with a file.
   *
   * Deliberately the repo root and not the source root: a path is only resolvable by a
   * consumer that has the checkout, and what it has is the checkout, not `src/`.
   */
  repoRoot: string;
}

export interface Reporter {
  name: string;
  onRunStart?(info: RunInfo): void | Promise<void>;
  /** Streaming, called as each violation is found. */
  onViolation?(v: Violation): void | Promise<void>;
  /** Batch. Awaited, so a reporter may write a file or flush a socket. */
  onRunEnd(result: AnalysisResult): void | Promise<void>;
}

export function defineReporter(reporter: Reporter): Reporter {
  return reporter;
}
