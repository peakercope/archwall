import { displayModuleId } from "./graph/ir.js";
import { toRelative } from "./paths.js";
import type { Violation, ViolationLocation } from "./violations.js";
import { FINGERPRINT_SCHEME } from "./violations.js";

/**
 * One accepted violation.
 *
 * `fingerprint` is the ONLY field matching keys on. Everything else is context for the human
 * reading the diff, and is deliberately regenerated rather than compared — a rule improving
 * its wording must not invalidate the debt a team already accepted, which is the whole reason
 * `fingerprintOf` excludes the message in the first place.
 *
 * The alternative — a file of bare hashes — was rejected because a baseline lands in a pull
 * request, and "+4 opaque hashes" is not something a reviewer can approve.
 */
export interface BaselineEntry {
  fingerprint: string;
  /** Rule instance id. Context only. */
  ruleId: string;
  /** Repo-relative rendering of the primary location. Context only. */
  location: string;
  /** Rendered message at the time the entry was written. Context only. */
  message: string;
}

export interface BaselineFile {
  /**
   * The fingerprint scheme the entries were produced under; must equal
   * {@link FINGERPRINT_SCHEME}.
   *
   * Checked rather than ignored because the failure is otherwise invisible: under a bumped
   * scheme every entry stops matching, and a silent no-match looks exactly like "someone
   * introduced 400 violations" — which is the one message this file exists to prevent.
   */
  scheme: string;
  entries: readonly BaselineEntry[];
}

/** Either a usable file or the reason it is not; never a throw. See {@link parseBaseline}. */
export type BaselineParseResult = { file: BaselineFile } | { error: string };

/** The partition {@link applyBaseline} produces. */
export interface AppliedBaseline {
  /** Findings that COUNT — not present in the baseline. */
  violations: readonly Violation[];
  /** Findings the baseline accepted, in the same relative order. */
  suppressed: readonly Violation[];
  /**
   * Fingerprints in the baseline that this run did not produce.
   *
   * Reported, never acted on here: whether they mean "fixed" or "not looked at" depends on
   * whether the run was complete, which is knowledge only the run edge has.
   */
  stale: readonly string[];
}

/** Repo-relative, scheme-stripped rendering of a location, for human review of the file. */
function locationLabel(repoRoot: string, l: ViolationLocation | undefined): string {
  if (l === undefined) return "";
  const idOf = (id: string): string => displayModuleId(toRelative(repoRoot, id));
  switch (l.type) {
    case "edge":
      return `${idOf(l.edge.from)} -> ${idOf(l.edge.to)}`;
    case "module":
      return idOf(l.module);
    case "path":
      return toRelative(repoRoot, l.path);
  }
}

function entryOf(repoRoot: string, v: Violation): BaselineEntry {
  return {
    fingerprint: v.fingerprint,
    ruleId: v.ruleId,
    location: locationLabel(repoRoot, v.locations[0]),
    message: v.message,
  };
}

/**
 * Renders a baseline file. Deterministic: two runs over the same findings produce the same
 * bytes, so a regenerated baseline that changed is a change in the findings.
 *
 * Sorted by `(ruleId, location, fingerprint)` and NOT by message — a reworded rule would
 * otherwise reorder the file and turn a no-op regeneration into a large diff. Deduped by
 * fingerprint, because one fingerprint can legitimately cover several findings.
 */
export function serializeBaseline(violations: readonly Violation[], repoRoot: string): string {
  const byFingerprint = new Map<string, BaselineEntry>();
  for (const v of violations) {
    if (!byFingerprint.has(v.fingerprint)) byFingerprint.set(v.fingerprint, entryOf(repoRoot, v));
  }
  const entries = [...byFingerprint.values()].sort(
    (a, b) =>
      a.ruleId.localeCompare(b.ruleId) ||
      a.location.localeCompare(b.location) ||
      a.fingerprint.localeCompare(b.fingerprint),
  );
  const file: BaselineFile = { scheme: FINGERPRINT_SCHEME, entries };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Reads a baseline file.
 *
 * Returns the reason instead of throwing: the caller is the run edge, and every failure here
 * has to become a `baseline-invalid` diagnostic rather than an exception that destroys the
 * other findings in the run.
 */
export function parseBaseline(text: string): BaselineParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { error: `not valid JSON (${err instanceof Error ? err.message : String(err)})` };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "expected a JSON object" };
  }
  const { scheme, entries } = raw as { scheme?: unknown; entries?: unknown };
  if (typeof scheme !== "string") return { error: 'missing a string "scheme" field' };
  if (scheme !== FINGERPRINT_SCHEME) {
    return {
      error:
        `written under fingerprint scheme "${scheme}", but this version of ArchWall produces ` +
        `"${FINGERPRINT_SCHEME}" — every entry would silently fail to match. Regenerate it ` +
        "with `archwall check --update-baseline`.",
    };
  }
  if (!Array.isArray(entries)) return { error: 'missing an "entries" array' };
  const parsed: BaselineEntry[] = [];
  for (const [i, e] of entries.entries()) {
    if (
      typeof e !== "object" ||
      e === null ||
      typeof (e as BaselineEntry).fingerprint !== "string"
    ) {
      return { error: `entry ${i} has no string "fingerprint"` };
    }
    const entry = e as Partial<BaselineEntry> & { fingerprint: string };
    parsed.push({
      fingerprint: entry.fingerprint,
      ruleId: typeof entry.ruleId === "string" ? entry.ruleId : "",
      location: typeof entry.location === "string" ? entry.location : "",
      message: typeof entry.message === "string" ? entry.message : "",
    });
  }
  return { file: { scheme, entries: parsed } };
}

/**
 * Splits findings into counted and accepted, by fingerprint.
 *
 * Input order is preserved in both outputs, so the total order `compareViolations` established
 * survives suppression and reporter output stays byte-stable.
 *
 * A fingerprint that matches several findings suppresses ALL of them — two imports of one
 * dependency from one module share a fingerprint by design (see `fingerprintOf`), and
 * accepting "domain must not import react" has to mean accepting it, not one arbitrary half.
 */
export function applyBaseline(
  violations: readonly Violation[],
  file: BaselineFile,
): AppliedBaseline {
  const accepted = new Set(file.entries.map((e) => e.fingerprint));
  const kept: Violation[] = [];
  const suppressed: Violation[] = [];
  const seen = new Set<string>();
  for (const v of violations) {
    if (accepted.has(v.fingerprint)) {
      suppressed.push(v);
      seen.add(v.fingerprint);
    } else {
      kept.push(v);
    }
  }
  return {
    violations: kept,
    suppressed,
    stale: [...accepted].filter((f) => !seen.has(f)).sort(),
  };
}
