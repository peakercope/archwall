import type { OutputDestination, OutputSink, Reporter, ReporterIO } from "../contracts/reporter.js";
import { ArchWallError } from "../errors.js";
import { consoleReporter, defaultIO } from "./console.js";
import { jsonReporter } from "./json.js";
import { sarifReporter } from "./sarif.js";

export type BuiltinReporterName = "console" | "json" | "sarif";

export const BUILTIN_REPORTER_NAMES: readonly BuiltinReporterName[] = ["console", "json", "sarif"];

const BUILTINS: Record<BuiltinReporterName, (sink: OutputSink) => Reporter> = {
  console: consoleReporter,
  json: jsonReporter,
  sarif: sarifReporter,
};

export function isBuiltinReporterName(name: string): name is BuiltinReporterName {
  return name in BUILTINS;
}

/**
 * A reporter plus where its output goes.
 *
 * The object form exists so that `sarif` can write `archwall.sarif` while `console` keeps
 * the terminal, in one run. Without it every reporter shares one stream and machine-readable
 * output is contaminated by human-readable output.
 */
export interface ReporterOutputSpec {
  reporter: BuiltinReporterName | Reporter;
  /** Default `"stdout"`. Also accepts `"stderr"` or a file path. */
  output?: OutputDestination;
}

/**
 * `string` is accepted so a config file can name a third-party reporter
 * (`"archwall-reporter-teamcity"`). Those are resolved to objects before reaching the
 * engine; a string that survives to here is one nothing could load.
 */
export type ReporterSpec = BuiltinReporterName | Reporter | ReporterOutputSpec | (string & {});

export interface ResolvedReporters {
  reporters: readonly Reporter[];
  /** Closes every sink this opened. Awaited after `onRunEnd`, before acting on the result. */
  close(): Promise<void>;
}

function normalize(spec: ReporterSpec): ReporterOutputSpec {
  if (typeof spec === "string") return { reporter: spec as BuiltinReporterName };
  if ("reporter" in spec) return spec;
  return { reporter: spec };
}

export function resolveReporters(
  specs: readonly ReporterSpec[],
  io: ReporterIO = defaultIO,
): ResolvedReporters {
  const opened: OutputSink[] = [];
  const reporters = specs.map((raw) => {
    const spec = normalize(raw);
    if (typeof spec.reporter !== "string") return spec.reporter;
    const factory = BUILTINS[spec.reporter as BuiltinReporterName];
    if (!factory) {
      throw new ArchWallError(
        `Unknown reporter "${spec.reporter}". Built-ins: ${BUILTIN_REPORTER_NAMES.join(", ")}. ` +
          `A third-party reporter must be installed and resolvable, or passed as an object.`,
      );
    }
    const sink = io.open(spec.output ?? "stdout");
    opened.push(sink);
    return factory(sink);
  });

  return {
    reporters,
    async close() {
      for (const sink of opened) await sink.close?.();
    },
  };
}
