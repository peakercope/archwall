import type { OutputSink, Reporter } from "../contracts/reporter.js";
import { toRelative } from "../paths.js";
import type { Violation, ViolationLocation } from "../violations.js";

/**
 * Ids keep their scheme — a machine consumer wants the identity it can correlate against a
 * fingerprint or a baseline, not a prettified path
 *
 * `toRelative` is still applied, and is a no-op on a canonical id, which is never absolute. It
 * is here for the ids that are not canonical: an in-memory graph built by hand uses bare
 * absolute paths, and this document has to be identical on every machine either way.
 */
function serializeLocation(repoRoot: string, l: ViolationLocation): Record<string, unknown> {
  switch (l.type) {
    case "edge":
      return {
        type: "edge",
        edge: {
          ...l.edge,
          from: toRelative(repoRoot, l.edge.from),
          to: toRelative(repoRoot, l.edge.to),
          resolvedPath: toRelative(repoRoot, l.edge.resolvedPath),
          ...(l.edge.loc !== undefined
            ? { loc: { ...l.edge.loc, file: toRelative(repoRoot, l.edge.loc.file) } }
            : {}),
        },
      };
    case "module":
      return { type: "module", module: toRelative(repoRoot, l.module) };
    case "path":
      return {
        type: "path",
        path: toRelative(repoRoot, l.path),
        ...(l.loc !== undefined
          ? { loc: { ...l.loc, file: toRelative(repoRoot, l.loc.file) } }
          : {}),
      };
  }
}

/** Paths are repository-relative so the document is identical on every machine. */
function serialize(repoRoot: string, v: Violation): Record<string, unknown> {
  return {
    ruleName: v.ruleName,
    ruleId: v.ruleId,
    severity: v.severity,
    message: v.message,
    ...(v.messageId !== undefined ? { messageId: v.messageId } : {}),
    ...(v.data !== undefined ? { data: v.data } : {}),
    locations: v.locations.map((l) => serializeLocation(repoRoot, l)),
    ...(v.explanation !== undefined ? { explanation: v.explanation } : {}),
    fingerprint: v.fingerprint,
  };
}

export function jsonReporter(sink: OutputSink): Reporter {
  return {
    name: "json",
    onRunEnd(result) {
      sink.write(
        JSON.stringify(
          {
            violations: result.violations.map((v) => serialize(result.repoRoot, v)),
            diagnostics: result.diagnostics,
            rules: result.rules,
            stats: result.stats,
            host: {
              name: result.host.name,
              version: result.host.version,
              capabilities: [...result.host.capabilities],
            },
            delivery: result.delivery,
          },
          null,
          2,
        ),
      );
    },
  };
}
