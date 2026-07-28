#!/usr/bin/env node
import { parseArgs } from "node:util";
import type { FailOn, ReporterSpec, UserConfig } from "@archwall/core";
import { loadConfig } from "@archwall/integration-kit";
import { check } from "./check.js";

const USAGE = `Usage: archwall check [options]

  --config <path>          Path to an archwall.config file
  --reporter <name>        Reporter to run; repeatable (console, json, sarif, or a package)
  --output <dest>          Where the preceding --reporter writes: a file path, stdout, stderr
  --fail-on <level>        error | warn | never
  --cwd <dir>              Directory to resolve the config and sources from
  --help

  --reporter and --output pair up positionally:
    archwall check --reporter console --reporter sarif --output archwall.sarif`;

/**
 * Pairs each `--reporter` with the `--output` that follows it.
 *
 * `parseArgs` gives back two independent lists, so the pairing has to come from argv order.
 * An `--output` with no preceding `--reporter` is an error rather than a guess.
 */
function pairReporters(argv: readonly string[]): { specs: ReporterSpec[]; error?: string } {
  const specs: ReporterSpec[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const flagValue = (flag: string): string | undefined => {
      if (arg === flag) return argv[++i];
      if (arg?.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
      return undefined;
    };
    const reporter = flagValue("--reporter");
    if (reporter !== undefined) {
      specs.push({ reporter } as ReporterSpec);
      continue;
    }
    const output = flagValue("--output");
    if (output !== undefined) {
      const last = specs[specs.length - 1];
      if (last === undefined || typeof last !== "object") {
        return { specs, error: "--output must follow a --reporter it applies to." };
      }
      (last as { output?: string }).output = output;
    }
  }
  return { specs };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: "string" },
      reporter: { type: "string", multiple: true },
      output: { type: "string", multiple: true },
      "fail-on": { type: "string" },
      cwd: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help || positionals[0] !== "check") {
    console.log(USAGE);
    process.exitCode = values.help ? 0 : 2;
    return;
  }

  const { specs, error } = pairReporters(argv);
  if (error !== undefined) {
    console.error(error);
    process.exitCode = 2;
    return;
  }

  const cwd = values.cwd ?? process.cwd();
  // CLI flags are inline overrides merged over the loaded file config.
  const { config: fileConfig } = await loadConfig({
    cwd,
    ...(values.config !== undefined ? { configPath: values.config } : {}),
  });
  const config: UserConfig = {
    ...fileConfig,
    ...(specs.length > 0 ? { reporters: specs } : {}),
    ...(values["fail-on"] !== undefined ? { failOn: values["fail-on"] as FailOn } : {}),
  };
  const { failed, summary } = await check({ cwd, config });
  // stderr, always: a machine-readable reporter owns stdout, and commentary sharing that
  // stream is what makes `--reporter json > out.json` produce something that is not JSON.
  // See docs/adr/0006-reporter-output-destinations.md.
  console.error(summary);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 2;
});
