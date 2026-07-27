import type { ReporterIO, UserConfig } from "@archwall/core";
import { createArchWallRun, type RunResult } from "@archwall/integration-kit";
import { buildGraphFromFilesystem, cliHost } from "./scan.js";

export interface CheckOptions {
  cwd?: string;
  configPath?: string;
  /** Inline config; wins over the discovered file. */
  config?: UserConfig;
  io?: ReporterIO;
}

export async function check(opts: CheckOptions = {}): Promise<RunResult> {
  const host = cliHost();
  const run = await createArchWallRun({
    host,
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    ...(opts.configPath !== undefined ? { configPath: opts.configPath } : {}),
    ...(opts.config !== undefined ? { config: opts.config } : {}),
    ...(opts.io !== undefined ? { io: opts.io } : {}),
  });
  const graph = await buildGraphFromFilesystem(run.config, host);
  return run.analyze(graph);
}
