import type { OutputDestination, OutputSink, Reporter, ReporterIO } from "../contracts/reporter.js";
import { ArchWallError } from "../errors.js";
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
  // The printed id is exactly the string to paste into `overrides`.
  const lines = [`[${v.severity}] ${v.ruleId}: ${v.message}`];
  const loc = primarySourceLocation(v);
  if (loc) lines.push(`  at ${at(loc.file)}:${loc.line}:${loc.column}`);
  for (const l of v.locations) {
    if (l.type === "edge") {
      lines.push(
        l.edge.rawSpecifier !== l.edge.resolvedPath
          ? `  import "${l.edge.rawSpecifier}" → resolves to ${at(l.edge.resolvedPath)}`
          : `  import "${l.edge.rawSpecifier}"`,
      );
    }
  }
  // A finding with several module locations — a cycle — lists them, rather than naming one
  // and burying the rest in prose.
  const modules = v.locations.filter((l) => l.type === "module");
  if (modules.length > 1) {
    for (const m of modules) lines.push(`  · ${at(m.module)}`);
  }
  if (v.explanation) lines.push(`  ${v.explanation}`);
  return lines.join("\n");
}

export function consoleReporter(sink: OutputSink): Reporter {
  // Dedup between the streaming `onViolation` channel and the batch `onRunEnd` one, for
  // ONE run. Cleared at the start of every run: the run object is memoized across watch
  // rebuilds in both bundler adapters, so a set living for the reporter's lifetime would
  // retain every Violation the process had ever produced.
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
      sink.write(formatViolation(v, repoRoot));
    },
    onRunEnd(result) {
      for (const v of result.violations) {
        if (!seen.has(v)) sink.write(formatViolation(v, result.repoRoot));
      }
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
