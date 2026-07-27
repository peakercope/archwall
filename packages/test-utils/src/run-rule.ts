import type { ProjectGraph, Rule, Severity, Violation } from "@archwall/core";
import { analyze, configureRule, resolveConfig } from "@archwall/core";

/** Runs a single rule through the real engine against a fixture graph. */
export async function runRule<O>(
  rule: Rule<O>,
  graph: ProjectGraph,
  options?: Partial<O>,
  /** For path-aware rules. `repoRoot` defaults to "/", `sourceRoot` to `repoRoot`. */
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
    { cwd: opts?.repoRoot ?? "/" },
  );
  const result = await analyze(graph, config);
  return result.violations;
}

export interface ExpectedViolation {
  rule?: string;
  from?: string;
  to?: string;
  module?: string;
  messageIncludes?: string;
}

function matches(v: Violation, e: ExpectedViolation): boolean {
  if (e.rule !== undefined && v.ruleName !== e.rule) return false;
  if (e.from !== undefined && v.edge?.from !== e.from) return false;
  if (e.to !== undefined && v.edge?.to !== e.to) return false;
  if (e.module !== undefined && v.module !== e.module) return false;
  if (e.messageIncludes !== undefined && !v.message.includes(e.messageIncludes)) return false;
  return true;
}

function describeViolation(v: Violation): string {
  const where = v.edge ? `${v.edge.from} → ${v.edge.to}` : (v.module ?? "<no location>");
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
