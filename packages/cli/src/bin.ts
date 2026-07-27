#!/usr/bin/env node
import { parseArgs } from "node:util";
import type { BuiltinReporterName, FailOn, UserConfig } from "@archwall/core";
import { loadConfig } from "@archwall/integration-kit";
import { check } from "./check.js";

const USAGE = `Usage: archwall check [--config <path>] [--reporter <name>]... [--fail-on error|warn|never] [--cwd <dir>]`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      config: { type: "string" },
      reporter: { type: "string", multiple: true },
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
  const cwd = values.cwd ?? process.cwd();
  // CLI flags are inline overrides merged over the loaded file config.
  const { config: fileConfig } = await loadConfig({
    cwd,
    ...(values.config !== undefined ? { configPath: values.config } : {}),
  });
  const config: UserConfig = {
    ...fileConfig,
    ...(values.reporter !== undefined && values.reporter.length > 0
      ? { reporters: values.reporter as BuiltinReporterName[] }
      : {}),
    ...(values["fail-on"] !== undefined ? { failOn: values["fail-on"] as FailOn } : {}),
  };
  const { failed, summary } = await check({ cwd, config });
  console.log(summary);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 2;
});
