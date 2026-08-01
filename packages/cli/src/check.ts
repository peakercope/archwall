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
  const { graph, diagnostics } = await buildGraphFromFilesystem(run.config, host);
  // Producer diagnostics go through the run edge's own channel, so they land in
  // `result.diagnostics` and are gated by `failOnDiagnostics` like every other kind.
  return run.check(graph, { diagnostics });
}
