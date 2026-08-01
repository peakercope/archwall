import type { Edge, ModuleId, SourceLocation } from "./graph/ir.js";
import { hashParts, toRelative } from "./paths.js";

/**
 * The ONE severity vocabulary, shared by violations and diagnostics.
 *
 * `info` is available to violations too: a rule may report something worth surfacing that
 * should never gate a build.
 */
export type Severity = "error" | "warn" | "info";

/**
 * Where a violation is.
 *
 * A tagged union rather than a pair of optional fields, and an ARRAY on the violation
 * rather than one value, because findings are not all edge-shaped. A cycle has no single
 * offending location — it has N of them, and the old model could only name one and had to
 * serialise the rest into the message string. A finding about a package, a directory, or
 * the configuration has no module at all.
 */
export type ViolationLocation =
  | { type: "edge"; edge: Edge }
  | { type: "module"; module: ModuleId }
  | { type: "path"; path: string; loc?: SourceLocation };

export interface Violation {
  ruleName: string;
  /**
   * Rule *instance* id — what you put in `overrides`, and what every reporter prints.
   * Differs from `ruleName` when the rule came from a preset (`fsd/public-api`) or was
   * given an explicit id; equal to it otherwise.
   */
  ruleId: string;
  severity: Severity;
  /** Rendered human summary. Derived from `messageId` + `data` unless set literally. */
  message: string;
  /**
   * Stable identifier for WHICH of the rule's messages this is, independent of wording.
   * Machine consumers group on this; translators key on it; `ConfiguredRule.message`
   * retargets it.
   */
  messageId?: string;
  /**
   * The values interpolated into the message — and the structured payload a reporter needs
   * in order to do anything other than print English. Without it a consumer wanting the
   * layer names out of a `layer-dependencies` finding has to parse the sentence.
   */
  data?: Readonly<Record<string, string | number>>;
  /**
   * Every place this finding is about, most significant first. Always at least one entry
   * for a rule that reported a location; may be empty for a finding about the run itself.
   */
  locations: readonly ViolationLocation[];
  /** "Why": resolution chain, which constraint, how to fix. */
  explanation?: string;
  /**
   * Stable, machine-independent identity. The same architecture problem on two developers'
   * machines, or under two bundlers, yields the same fingerprint.
   *
   * This is what makes a baseline file possible, and a graph-based linter has no other
   * suppression mechanism available: with no source text there can be no `// archwall-ignore`.
   */
  fingerprint: string;
}

export interface ViolationInput {
  /** Literal message. Mutually exclusive with `messageId`; one of the two is required. */
  message?: string;
  /** Key into the rule's `meta.messages`. Preferred — it is what `data` interpolates into. */
  messageId?: string;
  data?: Record<string, string | number>;
  /** Convenience for the overwhelmingly common single-edge finding. */
  edge?: Edge;
  /** Convenience for the single-module finding. */
  module?: ModuleId;
  /** Full control, for findings with several locations or a non-module subject. */
  locations?: readonly ViolationLocation[];
  explanation?: string;
  /**
   * Overrides the rule instance's configured severity for this one finding — e.g. a
   * two-module cycle as a warning and a forty-module cycle as an error.
   */
  severity?: Severity;
  /**
   * Explicit identity, for findings whose sameness is not captured by their locations.
   * Order-insensitive: parts are sorted before hashing.
   */
  identity?: readonly string[];
}

/** Normalizes the three input spellings into the canonical location list. */
export function locationsOf(input: ViolationInput): readonly ViolationLocation[] {
  if (input.locations !== undefined) return input.locations;
  if (input.edge !== undefined) return [{ type: "edge", edge: input.edge }];
  if (input.module !== undefined) return [{ type: "module", module: input.module }];
  return [];
}

/** The edge a finding is primarily about, when it is about one. */
export function primaryEdge(v: Pick<Violation, "locations">): Edge | undefined {
  for (const l of v.locations) if (l.type === "edge") return l.edge;
  return undefined;
}

/** The module a finding is primarily about: an explicit module, else an edge's source. */
export function primaryModule(v: Pick<Violation, "locations">): ModuleId | undefined {
  for (const l of v.locations) {
    if (l.type === "module") return l.module;
    if (l.type === "edge") return l.edge.from;
  }
  return undefined;
}

/** Where a finding should be anchored in an editor or in SARIF, when that is knowable. */
export function primarySourceLocation(v: Pick<Violation, "locations">): SourceLocation | undefined {
  for (const l of v.locations) {
    if (l.type === "edge" && l.edge.loc !== undefined) return l.edge.loc;
    if (l.type === "path" && l.loc !== undefined) return l.loc;
  }
  return undefined;
}

/**
 * Renders `{placeholder}` templates. Unknown placeholders are left verbatim, so a
 * mis-keyed template is visible in the output rather than silently blank.
 */
export function renderMessage(
  template: string,
  data: Readonly<Record<string, string | number>> | undefined,
): string {
  if (data === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in data ? String(data[key]) : whole,
  );
}

/**
 * Fingerprint scheme version. Bump when the algorithm changes so that a stale baseline
 * ERRORS instead of silently mismatching every entry.
 *
 * `aw3` is the first scheme over canonical module ids. Before it, a violation about `react` hashed the
 * host's own id — a resolved `node_modules` path under the CLI, the bare specifier under esbuild
 * — so the same finding fingerprinted differently under two bundlers.
 */
export const FINGERPRINT_SCHEME = "aw3";

/**
 * `toRelative` is a no-op on a canonical id, which is never absolute — it is here for the ids
 * that are not canonical: in-memory graphs built by hand (`@archwall/test-utils`, a playground)
 * use bare absolute paths, and those must still fingerprint identically across machines.
 */
function locationParts(repoRoot: string, l: ViolationLocation): string[] {
  switch (l.type) {
    case "edge":
      // Endpoints ONLY. `rawSpecifier` and `kind` are host-variable — Vite expands an alias
      // before any plugin sees it, and `reexport` versus `static` is capability-gated — so
      // including them would make the fingerprint differ by bundler for one architectural
      // fact, which is exactly what canonical ids exist to prevent. The conformance suite
      // coarsens edge kinds for the same reason.
      //
      // The cost is that two imports of one target from one module (`react` and
      // `react/jsx-runtime`, which share the node `pkg:react`) share a fingerprint. That is
      // the right granularity for a baseline: "domain must not import react" is one finding.
      return ["e", toRelative(repoRoot, l.edge.from), toRelative(repoRoot, l.edge.to)];
    case "module":
      return ["m", toRelative(repoRoot, l.module)];
    case "path":
      return ["p", toRelative(repoRoot, l.path)];
  }
}

/**
 * Identity is (rule instance, offending locations) — deliberately NOT the message, so
 * improving the wording of a rule's output does not invalidate every baseline entry that
 * rule ever produced. `identity` overrides the locations when a rule knows better.
 */
export function fingerprintOf(
  repoRoot: string,
  ruleId: string,
  input: Pick<ViolationInput, "edge" | "module" | "locations" | "identity">,
): string {
  let parts: string[];
  if (input.identity !== undefined) {
    parts = input.identity.map((p) => toRelative(repoRoot, p)).sort();
  } else {
    const locations = locationsOf(input);
    parts = locations.length === 0 ? [""] : locations.flatMap((l) => locationParts(repoRoot, l));
  }
  return `${FINGERPRINT_SCHEME}:${hashParts([ruleId, ...parts])}`;
}

export type SeverityCounts = Record<Severity, number>;

/** One definition of "how many of each", shared by every consumer that needs counts. */
export function countBySeverity(violations: readonly { severity: Severity }[]): SeverityCounts {
  const counts: SeverityCounts = { error: 0, warn: 0, info: 0 };
  for (const v of violations) counts[v.severity]++;
  return counts;
}

/** Sortable string for a location, so ordering is a property of the finding. */
function locationKey(l: ViolationLocation | undefined): string {
  if (l === undefined) return "";
  switch (l.type) {
    case "edge":
      return `${l.edge.from} ${l.edge.to} ${l.edge.rawSpecifier}`;
    case "module":
      return l.module;
    case "path":
      return l.path;
  }
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
    locationKey(a.locations[0]).localeCompare(locationKey(b.locations[0])) ||
    a.message.localeCompare(b.message)
  );
}
