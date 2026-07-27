import type { Reporter } from "../contracts/reporter.js";
import { toRelative } from "../paths.js";
import type { Violation } from "../violations.js";
import { countBySeverity } from "../violations.js";

export interface ReporterIO {
  write(line: string): void;
}

export const defaultIO: ReporterIO = { write: (line) => console.log(line) };

/**
 * Shared violation block format — also used by adapters when mapping violations
 * into host diagnostics (error locality: anchored on the importer edge, resolution
 * shown as explanation, never as the location).
 *
 * `repoRoot` makes every path repository-relative. Absolute paths are the right module
 * identity *inside* a run and the wrong thing in every output: unreadable in a terminal,
 * and machine-specific in a file.
 */
export function formatViolation(v: Violation, repoRoot?: string): string {
  const at = (p: string): string => (repoRoot === undefined ? p : toRelative(repoRoot, p));
  // The printed id is exactly the string to paste into `overrides`.
  const lines = [`[${v.severity}] ${v.ruleId}: ${v.message}`];
  if (v.edge?.loc)
    lines.push(`  at ${at(v.edge.loc.file)}:${v.edge.loc.line}:${v.edge.loc.column}`);
  if (v.edge) {
    lines.push(
      v.edge.rawSpecifier !== v.edge.resolvedPath
        ? `  import "${v.edge.rawSpecifier}" → resolves to ${at(v.edge.resolvedPath)}`
        : `  import "${v.edge.rawSpecifier}"`,
    );
  }
  if (v.explanation) lines.push(`  ${v.explanation}`);
  return lines.join("\n");
}

export function consoleReporter(io: ReporterIO = defaultIO): Reporter {
  // Dedup between the streaming `onViolation` channel and the batch `onRunEnd` one, for
  // ONE run. It is cleared at the start of every run: this set used to live for the
  // lifetime of the reporter, and since the run object is memoized across watch rebuilds
  // in both bundler adapters, it grew without bound — retaining every Violation object
  // the process had ever produced.
  let seen = new Set<Violation>();
  let repoRoot: string | undefined;
  return {
    name: "console",
    onRunStart(info) {
      seen = new Set();
      repoRoot = info.repoRoot;
    },
    onViolation(v) {
      seen.add(v);
      io.write(formatViolation(v, repoRoot));
    },
    onRunEnd(result) {
      for (const v of result.violations) {
        if (!seen.has(v)) io.write(formatViolation(v, result.repoRoot));
      }
      // `docsUrl` existed on every rule's meta and nothing ever read it. A violation's
      // most useful next step is the rule's documentation, so print it once per rule that
      // actually fired rather than on every line.
      const docs = new Map(
        result.rules
          .filter((r) => r.docsUrl !== undefined && r.violations > 0)
          .map((r) => [r.id, r.docsUrl!]),
      );
      for (const [id, url] of docs) io.write(`  ${id}: ${url}`);
      for (const d of result.diagnostics) io.write(`${d.severity}: ${d.message}`);
      const { error, warn, info } = countBySeverity(result.violations);
      io.write(
        `${error} error(s), ${warn} warning(s)${info > 0 ? `, ${info} info` : ""} — ${result.stats.moduleCount} modules, ${result.stats.edgeCount} edges in ${Math.round(result.stats.durationMs)}ms`,
      );
    },
  };
}
