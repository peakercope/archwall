import type { OutputDestination, OutputSink, Reporter, ReporterIO } from "../contracts/reporter.js";
import { ArchWallError } from "../errors.js";
import { displayModuleId } from "../graph/ir.js";
import { toRelative } from "../paths.js";
import type { Violation } from "../violations.js";
import { countBySeverity, primarySourceLocation } from "../violations.js";

/**
 * Console-only IO: the portable default.
 *
 * Core stays runnable wherever a graph can be built — browser playground, worker, edge
 * runtime — so it cannot open files. A host with a filesystem supplies an IO that can
 * (`@archwall/integration-kit` exports `nodeIO`); asking this one for a file is an error
 * rather than a silent fallback to stdout, because a run that was told to write
 * `archwall.sarif` and printed to the terminal instead has failed at its actual job.
 */
export const defaultIO: ReporterIO = {
  open(destination: OutputDestination): OutputSink {
    if (destination === "stdout") return { write: (text) => console.log(text) };
    if (destination === "stderr") return { write: (text) => console.error(text) };
    throw new ArchWallError(
      `Cannot write reporter output to "${destination}": this environment has no filesystem. ` +
        `Use "stdout"/"stderr", or run through a host that supplies a filesystem-capable ReporterIO.`,
    );
  },
};

/**
 * Shared violation block format — also used by adapters when mapping violations into host
 * diagnostics (error locality: anchored on the importer edge, resolution shown as
 * explanation, never as the location).
 *
 * `repoRoot` makes every path repository-relative. Absolute paths are the right module
 * identity inside a run and the wrong thing in every output.
 */
export function formatViolation(v: Violation, repoRoot?: string): string {
  const at = (p: string): string => (repoRoot === undefined ? p : toRelative(repoRoot, p));
  // Module ids get BOTH treatments, and the order matters. A canonical id is never absolute, so
  // `at` passes it through and the scheme is then stripped; a bare id from an in-memory graph is
  // absolute, so `at` relativizes it and there is no scheme to strip. One expression, both
  // worlds, and neither ever prints a path from the machine that produced the graph.
  const idOf = (id: string): string => displayModuleId(at(id));
  // The printed id is exactly the string to paste into `overrides`.
  const lines = [`[${v.severity}] ${v.ruleId}: ${v.message}`];
  const loc = primarySourceLocation(v);
  if (loc) lines.push(`  at ${at(loc.file)}:${loc.line}:${loc.column}`);
  for (const l of v.locations) {
    if (l.type === "edge") {
      lines.push(
        l.edge.rawSpecifier !== l.edge.resolvedPath
          ? `  import "${l.edge.rawSpecifier}" → resolves to ${idOf(l.edge.resolvedPath)}`
          : `  import "${l.edge.rawSpecifier}"`,
      );
    }
  }
  // A finding with several module locations — a cycle — lists them, rather than naming one
  // and burying the rest in prose.
  const modules = v.locations.filter((l) => l.type === "module");
  if (modules.length > 1) {
    for (const m of modules) lines.push(`  · ${idOf(m.module)}`);
  }
  if (v.explanation) lines.push(`  ${v.explanation}`);
  return lines.join("\n");
}

/**
 * Stateless: one pass over the finished result, in `onRunEnd`.
 *
 * There is no `onRunStart` and no per-run state to reset, which is what makes it safe for
 * the run object to be memoized across watch rebuilds in the bundler adapters — a reporter
 * that accumulated anything would grow for the life of the process.
 */
export function consoleReporter(sink: OutputSink): Reporter {
  return {
    name: "console",
    onRunEnd(result) {
      for (const v of result.violations) sink.write(formatViolation(v, result.repoRoot));
      // A violation's most useful next step is the rule's documentation; print it once per
      // rule that actually fired rather than on every line.
      const docs = new Map(
        result.rules
          .filter((r) => r.docsUrl !== undefined && r.violations > 0)
          .map((r) => [r.id, r.docsUrl!]),
      );
      for (const [id, url] of docs) sink.write(`  ${id}: ${url}`);
      for (const d of result.diagnostics) sink.write(`${d.severity}: ${d.message}`);
      const { error, warn, info } = countBySeverity(result.violations);
      sink.write(
        `${error} error(s), ${warn} warning(s)${info > 0 ? `, ${info} info` : ""} — ${result.stats.moduleCount} modules, ${result.stats.edgeCount} edges in ${Math.round(result.stats.durationMs)}ms`,
      );
    },
  };
}
