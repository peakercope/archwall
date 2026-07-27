import type { Reporter } from "../contracts/reporter.js";
import { toRelative } from "../paths.js";
import type { Severity } from "../violations.js";
import { defaultIO, type ReporterIO } from "./console.js";

/** ArchWall's vocabulary is not SARIF's; `info` is SARIF's "note". */
const SARIF_LEVEL: Record<Severity, string> = {
  error: "error",
  warn: "warning",
  info: "note",
};

export function sarifReporter(io: ReporterIO = defaultIO): Reporter {
  return {
    name: "sarif",
    onRunEnd(result) {
      // Built from the rule INVENTORY, not from the violations: a rule that found nothing
      // still belongs in `tool.driver.rules`, and only the inventory carries the metadata
      // (`description`, `docsUrl`) that makes the entry worth anything to a consumer.
      // These used to be emitted as bare `{ id }` while `meta.description`/`meta.docsUrl`
      // sat unread.
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
              locations: v.edge?.loc
                ? [
                    {
                      physicalLocation: {
                        // MUST be root-relative: GitHub code scanning silently fails to
                        // associate a result with a repository file when given an
                        // absolute path from the machine that produced the run.
                        artifactLocation: {
                          uri: toRelative(result.repoRoot, v.edge.loc.file),
                        },
                        region: {
                          startLine: v.edge.loc.line,
                          startColumn: v.edge.loc.column + 1,
                        },
                      },
                    },
                  ]
                : [],
            })),
            // Diagnostics used to be dropped entirely, which meant
            // `no-modules-classified` — "ArchWall never looked at your code" — was
            // invisible in exactly the CI-integrated path where it matters most. SARIF
            // has a channel for tool-level notifications; this is it.
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
      io.write(JSON.stringify(doc, null, 2));
    },
  };
}
