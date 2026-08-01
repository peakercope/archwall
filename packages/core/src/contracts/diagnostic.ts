import type { Capability } from "../graph/ir.js";
import type { Severity } from "../violations.js";

/** Alias, for readability at use sites — it IS {@link Severity}. */
export type DiagnosticSeverity = Severity;

/**
 * Stable, machine-matchable identifiers. Open union — adapters and third-party rules may
 * emit their own codes; the ones core emits are enumerated by {@link WellKnownDiagnosticCode}.
 */
export type WellKnownDiagnosticCode =
  /** A rule required host capabilities this run cannot provide, and was skipped. */
  | "rule-skipped"
  /** A rule threw. The run continued; that rule produced no results. */
  | "rule-failed"
  /** Classification tagged nothing — almost always a misconfigured `sourceRoot`. */
  | "no-modules-classified"
  /** The project boundary (`include`/`exclude`) matched no source modules. */
  | "empty-project"
  /** A rule's `scope` narrowed the graph to nothing, so the rule could not report anything. */
  | "empty-scope"
  /** A rule's options failed its `optionsSchema` at config time; the rule did not run. */
  | "invalid-rule-options"
  /** The configuration itself is wrong; see the message. The rule or preset was dropped. */
  | "invalid-config"
  /** A configured rule, or one of its options, is deprecated. */
  | "rule-deprecated"
  /** A graph transform threw. The pipeline continued without its contribution. */
  | "transform-failed"
  /**
   * Files are inside the project boundary that the producer cannot read, so they are absent
   * from the graph entirely — not excluded, not unresolved, just invisible.
   *
   * Only a producer that ENUMERATES a directory tree can detect this, which in practice means
   * the CLI: a bundler adapter is handed a graph whose membership its compiler already decided.
   */
  | "unscannable-files"
  /**
   * The baseline lists violations this run did not produce — they were fixed, or the code
   * they were about is gone.
   *
   * Worth saying out loud rather than tolerating: a baseline that is never pruned stops being
   * "debt we accepted" and becomes a permanent hole, and the stale entry will silently
   * re-suppress the finding if it ever comes back.
   */
  | "baseline-stale"
  /**
   * A baseline is configured but could not be used: missing, unparseable, or written under a
   * different fingerprint scheme.
   *
   * Gated with the other configuration errors, and therefore failing by default. The failure
   * this prevents is specific: an unusable baseline suppresses nothing, so the run reports
   * every accepted finding as new — and a team that reads that as "the baseline is broken"
   * is the lucky case. Silence here would instead let a *scheme bump* look like a fresh
   * regression, or let a deleted baseline look like a clean repo.
   */
  | "baseline-invalid";

export type DiagnosticCode = WellKnownDiagnosticCode | (string & {});

/**
 * Everything the run wants to say that is *not* a violation of the user's architecture: a
 * rule that could not run, a rule that crashed, a configuration that looks wrong.
 *
 * A first-class channel because the alternative — an exception — is the wrong shape for
 * "one of your forty rules is broken": it destroys the other thirty-nine results.
 */
export interface Diagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  /** The rule instance this concerns, when it concerns one. */
  ruleId?: string;
  /** Structured payload for machine consumers; shape depends on `code`. */
  details?: Readonly<Record<string, unknown>>;
}

/** Payload shape for `code: "rule-skipped"`. */
export interface RuleSkippedDetails {
  missingCapabilities: readonly Capability[];
  host: string;
}

/** Payload shape for `code: "unscannable-files"`. */
export interface UnscannableFilesDetails {
  /** How many in-boundary files the producer could not read. */
  count: number;
  /** Distinct extensions, most common first — what to act on. */
  extensions: readonly string[];
  /** A bounded sample of repo-relative paths, for a message a human can follow. */
  sample: readonly string[];
}

/** Payload shape for `code: "baseline-stale"`. */
export interface BaselineStaleDetails {
  /** How many accepted entries this run did not reproduce. */
  count: number;
  /** The fingerprints, so a tool can prune the file without re-running the analysis. */
  fingerprints: readonly string[];
}

/** Payload shape for `code: "baseline-invalid"`. */
export interface BaselineInvalidDetails {
  /** Repo-relative path to the configured baseline. */
  path: string;
  /** Why it could not be used, as a sentence fragment. */
  reason: string;
}

/** Payload shape for `code: "empty-scope"`. */
export interface EmptyScopeDetails {
  /** The scope as configured, so the message can be acted on without reopening the config. */
  scope: { include?: readonly string[]; exclude?: readonly string[]; tag?: Record<string, string> };
  /** Modules in the graph before scoping — the denominator that makes "0" meaningful. */
  totalModules: number;
}
