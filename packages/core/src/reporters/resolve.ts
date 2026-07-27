import type { BuiltinReporterName } from "../config.js";
import type { Reporter } from "../contracts/reporter.js";
import { ArchWallError } from "../errors.js";
import { consoleReporter, type ReporterIO } from "./console.js";
import { jsonReporter } from "./json.js";
import { sarifReporter } from "./sarif.js";

const BUILTINS: Record<BuiltinReporterName, (io?: ReporterIO) => Reporter> = {
  console: consoleReporter,
  json: jsonReporter,
  sarif: sarifReporter,
};

export function resolveReporters(
  specs: readonly (BuiltinReporterName | Reporter)[],
  io?: ReporterIO,
): Reporter[] {
  return specs.map((spec) => {
    if (typeof spec !== "string") return spec;
    const factory = BUILTINS[spec];
    if (!factory)
      throw new ArchWallError(
        `Unknown reporter "${spec}". Built-ins: ${Object.keys(BUILTINS).join(", ")}.`,
      );
    return factory(io);
  });
}
