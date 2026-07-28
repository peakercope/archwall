import type { ProjectGraph, Rule, Severity, Violation } from "@archwall/core";
import { analyze, configureRule, primaryEdge, primaryModule, resolveConfig } from "@archwall/core";

/** Runs a single rule through the real engine against a fixture graph. */
export async function runRule<O>(
  rule: Rule<O>,
  graph: ProjectGraph,
  options?: Partial<O>,
  /** For path-aware rules. `repoRoot` defaults to the platform root, `sourceRoot` to it. */
  opts?: {
    repoRoot?: string;
    sourceRoot?: string;
    severity?: Severity | "off";
  },
): Promise<readonly Violation[]> {
  const config = resolveConfig(
    {
      rules: [
        configureRule(
          rule,
          options,
          ...(opts?.severity !== undefined ? [{ severity: opts.severity }] : []),
        ),
      ],
      ...(opts?.sourceRoot !== undefined ? { sourceRoot: opts.sourceRoot } : {}),
    },
    { cwd: opts?.repoRoot ?? defaultRoot() },
  );
  const result = await analyze(graph, config);
  return result.violations;
}

/**
 * The filesystem root of the current platform.
 *
 * Hardcoding `"/"` made every path-aware assertion in this helper subtly wrong on Windows,
 * where it is not an absolute path at all.
 */
function defaultRoot(): string {
  return process.platform === "win32" ? "C:\\" : "/";
}

export interface ExpectedViolation {
  rule?: string;
  from?: string;
  to?: string;
  module?: string;
  messageId?: string;
  messageIncludes?: string;
}

function matches(v: Violation, e: ExpectedViolation): boolean {
  const edge = primaryEdge(v);
  if (e.rule !== undefined && v.ruleName !== e.rule) return false;
  if (e.from !== undefined && edge?.from !== e.from) return false;
  if (e.to !== undefined && edge?.to !== e.to) return false;
  if (
    e.module !== undefined &&
    !v.locations.some((l) => l.type === "module" && l.module === e.module)
  )
    return false;
  if (e.messageId !== undefined && v.messageId !== e.messageId) return false;
  if (e.messageIncludes !== undefined && !v.message.includes(e.messageIncludes)) return false;
  return true;
}

function describeViolation(v: Violation): string {
  const edge = primaryEdge(v);
  const where = edge ? `${edge.from} → ${edge.to}` : (primaryModule(v) ?? "<no location>");
  return `${v.ruleName} [${where}]: ${v.message}`;
}

/** Order-insensitive match: each expectation must claim a distinct actual violation, and counts must agree. */
export function expectViolations(
  actual: readonly Violation[],
  expected: ExpectedViolation[],
): void {
  const remaining = [...actual];
  const unmet: ExpectedViolation[] = [];
  for (const e of expected) {
    const i = remaining.findIndex((v) => matches(v, e));
    if (i === -1) unmet.push(e);
    else remaining.splice(i, 1);
  }
  if (unmet.length > 0 || remaining.length > 0) {
    const parts = [`expected ${expected.length} violation(s), got ${actual.length}.`];
    if (unmet.length > 0)
      parts.push(`Unmatched expectations: ${unmet.map((e) => JSON.stringify(e)).join("; ")}`);
    if (remaining.length > 0)
      parts.push(`Unexpected violations: ${remaining.map(describeViolation).join("; ")}`);
    throw new Error(parts.join("\n"));
  }
}
