import type { Reporter } from "../contracts/reporter.js";
import { toRelative } from "../paths.js";
import type { Violation } from "../violations.js";
import { defaultIO, type ReporterIO } from "./console.js";

/** Paths are repository-relative so the document is identical on every machine. */
function serialize(repoRoot: string, v: Violation): Record<string, unknown> {
  return {
    ...v,
    ...(v.module !== undefined ? { module: toRelative(repoRoot, v.module) } : {}),
    ...(v.edge !== undefined
      ? {
          edge: {
            ...v.edge,
            from: toRelative(repoRoot, v.edge.from),
            to: toRelative(repoRoot, v.edge.to),
            resolvedPath: toRelative(repoRoot, v.edge.resolvedPath),
            ...(v.edge.loc !== undefined
              ? {
                  loc: {
                    ...v.edge.loc,
                    file: toRelative(repoRoot, v.edge.loc.file),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}

export function jsonReporter(io: ReporterIO = defaultIO): Reporter {
  return {
    name: "json",
    onRunEnd(result) {
      io.write(
        JSON.stringify(
          {
            violations: result.violations.map((v) => serialize(result.repoRoot, v)),
            diagnostics: result.diagnostics,
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
