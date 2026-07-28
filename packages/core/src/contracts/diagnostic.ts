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
  /** A rule's options failed its `optionsSchema` at config time; the rule did not run. */
  | "invalid-rule-options"
  /** The configuration itself is wrong; see the message. The rule or preset was dropped. */
  | "invalid-config"
  /** A configured rule, or one of its options, is deprecated. */
  | "rule-deprecated"
  /** A graph transform threw. The pipeline continued without its contribution. */
  | "transform-failed";

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

export function defineDiagnostic(d: Diagnostic): Diagnostic {
  return d;
}
