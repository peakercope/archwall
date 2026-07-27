import type { Edge, ModuleId } from "./graph/ir.js";
import { stableHash, toRelative } from "./paths.js";

/**
 * The ONE severity vocabulary, shared by violations and diagnostics.
 *
 * There used to be two: `Severity = "error" | "warn"` for violations and
 * `DiagnosticSeverity = "error" | "warning" | "info"` for diagnostics — two neighbouring
 * types, one saying `warn` and the other `warning`, for the same concept. `warn` wins
 * because it is the spelling users already type in `severity:`, `overrides`, and `failOn`.
 *
 * `info` is available to violations too: a rule may report something worth surfacing that
 * should never gate a build.
 */
export type Severity = "error" | "warn" | "info";

export interface Violation {
  ruleName: string;
  /**
   * Rule *instance* id — what you put in `overrides`, and what every reporter prints.
   * Differs from `ruleName` when the rule came from a preset (`fsd/public-api`) or was
   * given an explicit id; equal to it otherwise.
   *
   * Required, not optional. The engine always knows the id, so an absent one only ever
   * meant "a caller built a Violation by hand" — and every consumer paid for that with a
   * `v.ruleId ?? v.ruleName` fallback that silently printed an id you could not paste
   * into `overrides`.
   */
  ruleId: string;
  severity: Severity;
  /** Human summary. */
  message: string;
  /** Offending dependency, incl. raw + resolved. */
  edge?: Edge;
  module?: ModuleId;
  /** "Why": resolution chain, which constraint, how to fix. */
  explanation?: string;
  /**
   * Stable, machine-independent identity for this violation. The same architecture
   * problem on two developers' machines, or under two different bundlers, yields the
   * same fingerprint.
   *
   * This is what makes a baseline file possible, and a graph-based linter has no other
   * suppression mechanism available: with no source text and no AST there can be no
   * `// archwall-ignore` comment. Identity therefore has to be a property of the
   * *finding*, and it has to exist before anyone depends on it.
   */
  fingerprint: string;
}

export interface ViolationInput {
  message: string;
  edge?: Edge;
  module?: ModuleId;
  explanation?: string;
  /**
   * Overrides the rule instance's configured severity for this one finding — e.g. a
   * two-module cycle as a warning and a forty-module cycle as an error.
   */
  severity?: Severity;
  /**
   * Explicit identity, for findings whose sameness is not captured by one edge or one
   * module. A cycle is the motivating case: it has no single offending location, and
   * anchoring it on the alphabetically-first member means adding an unrelated file that
   * sorts earlier silently changes the fingerprint of an unchanged cycle — future
   * baseline churn for a problem nobody touched.
   *
   * Order-insensitive: the parts are sorted before hashing, so callers may pass a set in
   * whatever order they have it.
   */
  identity?: readonly string[];
}

/**
 * Fingerprint scheme version. Bump when the algorithm changes so that a stale baseline
 * ERRORS instead of silently mismatching every entry — the one property that is
 * impossible to add after the first baseline ships.
 */
export const FINGERPRINT_SCHEME = "aw1";

/**
 * Identity is (rule instance, offending location, what was written) — deliberately NOT
 * the message, so improving the wording of a rule's output does not invalidate every
 * baseline entry that rule ever produced.
 */
export function fingerprintOf(
  repoRoot: string,
  ruleId: string,
  input: Pick<ViolationInput, "edge" | "module" | "identity">,
): string {
  let parts: string[];
  if (input.identity !== undefined) {
    parts = input.identity.map((p) => toRelative(repoRoot, p)).sort();
  } else if (input.edge) {
    parts = [
      toRelative(repoRoot, input.edge.from),
      toRelative(repoRoot, input.edge.to),
      input.edge.rawSpecifier,
      input.edge.kind,
    ];
  } else {
    parts = [toRelative(repoRoot, input.module ?? "")];
  }
  return `${FINGERPRINT_SCHEME}:${stableHash([ruleId, ...parts].join(" "))}`;
}

export type SeverityCounts = Record<Severity, number>;

/**
 * One definition of "how many of each". Both the console summary and the run edge's
 * pass/fail decision used to derive counts independently, each treating "not an error" as
 * "a warning" — which silently made every `info` finding print as a warning the moment
 * `info` existed.
 */
export function countBySeverity(violations: readonly { severity: Severity }[]): SeverityCounts {
  const counts: SeverityCounts = { error: 0, warn: 0, info: 0 };
  for (const v of violations) counts[v.severity]++;
  return counts;
}

/**
 * Total order over violations, so two runs of the same analysis produce byte-identical
 * output. Required by baselines, CI diffing, and snapshot tests; without it, ordering
 * follows rule registration order and each rule's internal scan order, which differs
 * between hosts because module insertion order does.
 */
export function compareViolations(a: Violation, b: Violation): number {
  return (
    a.ruleId.localeCompare(b.ruleId) ||
    (a.edge?.from ?? a.module ?? "").localeCompare(b.edge?.from ?? b.module ?? "") ||
    (a.edge?.to ?? "").localeCompare(b.edge?.to ?? "") ||
    (a.edge?.rawSpecifier ?? "").localeCompare(b.edge?.rawSpecifier ?? "") ||
    a.message.localeCompare(b.message)
  );
}
