import type { OutputSink, Reporter } from "../contracts/reporter.js";
import { toRelative } from "../paths.js";
import type { Severity, Violation } from "../violations.js";
import { primarySourceLocation } from "../violations.js";

/** ArchWall's vocabulary is not SARIF's; `info` is SARIF's "note". */
const SARIF_LEVEL: Record<Severity, string> = {
  error: "error",
  warn: "warning",
  info: "note",
};

/**
 * SARIF locations for a violation.
 *
 * All of them, not just the first: a cycle is one result about N files, and SARIF's
 * `locations` array is exactly the right shape for that. Locations without a source
 * position are omitted — SARIF needs a `physicalLocation`, and inventing line 1 for a
 * module the host gave us no position for would point reviewers at the wrong line.
 */
function sarifLocations(repoRoot: string, v: Violation): unknown[] {
  const out: unknown[] = [];
  for (const l of v.locations) {
    const loc = l.type === "edge" ? l.edge.loc : l.type === "path" ? l.loc : undefined;
    if (loc === undefined) continue;
    out.push({
      physicalLocation: {
        // MUST be root-relative: GitHub code scanning silently fails to associate a result
        // with a repository file when given an absolute path from the producing machine.
        artifactLocation: { uri: toRelative(repoRoot, loc.file) },
        region: { startLine: loc.line, startColumn: loc.column + 1 },
      },
    });
  }
  if (out.length > 0) return out;
  // No positions anywhere: fall back to naming the file, without a region.
  const fallback = primarySourceLocation(v);
  if (fallback !== undefined) {
    return [
      {
        physicalLocation: {
          artifactLocation: { uri: toRelative(repoRoot, fallback.file) },
        },
      },
    ];
  }
  return [];
}

export function sarifReporter(sink: OutputSink): Reporter {
  return {
    name: "sarif",
    onRunEnd(result) {
      // Built from the rule INVENTORY, not from the violations: a rule that found nothing
      // still belongs in `tool.driver.rules`, and only the inventory carries the metadata
      // that makes the entry worth anything to a consumer.
      const described = new Map(result.rules.map((r) => [r.id, r]));
      for (const v of result.violations) {
        if (!described.has(v.ruleId)) {
          described.set(v.ruleId, {
            id: v.ruleId,
            name: v.ruleName,
            description: "",
            severity: v.severity,
            status: "ran",
            violations: 0,
            durationMs: 0,
          });
        }
      }
      const doc = {
        $schema:
          "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
        version: "2.1.0",
        runs: [
          {
            tool: {
              driver: {
                name: "archwall",
                rules: [...described.values()].map((r) => ({
                  id: r.id,
                  name: r.name,
                  ...(r.description !== "" ? { shortDescription: { text: r.description } } : {}),
                  // SARIF requires an absolute URI here; anything else is silently useless
                  // to a consumer, so an unset or relative `docsUrl` is simply omitted.
                  ...(r.docsUrl !== undefined && /^https?:\/\//.test(r.docsUrl)
                    ? { helpUri: r.docsUrl }
                    : {}),
                })),
              },
            },
            results: result.violations.map((v) => ({
              ruleId: v.ruleId,
              level: SARIF_LEVEL[v.severity],
              message: {
                text: v.explanation ? `${v.message} — ${v.explanation}` : v.message,
              },
              // Lets consuming tools track a finding across commits even as it moves.
              partialFingerprints: { archwall: v.fingerprint },
              ...(v.data !== undefined ? { properties: v.data } : {}),
              locations: sarifLocations(result.repoRoot, v),
            })),
            // SARIF has a channel for tool-level notifications; diagnostics belong in it.
            // Dropping them made `no-modules-classified` — "ArchWall never looked at your
            // code" — invisible in exactly the CI path where it matters most.
            invocations: [
              {
                executionSuccessful: !result.diagnostics.some((d) => d.severity === "error"),
                toolExecutionNotifications: result.diagnostics.map((d) => ({
                  level: SARIF_LEVEL[d.severity],
                  message: { text: d.message },
                  descriptor: { id: d.code },
                  ...(d.ruleId !== undefined ? { associatedRule: { id: d.ruleId } } : {}),
                })),
              },
            ],
          },
        ],
      };
      sink.write(JSON.stringify(doc, null, 2));
    },
  };
}
