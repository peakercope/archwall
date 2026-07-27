import * as fs from "node:fs";
import * as path from "node:path";
import type { UserConfig } from "@archwall/core";
import { ArchWallError } from "@archwall/core";
import { createJiti } from "jiti";

export interface LoadConfigOptions {
  configPath?: string;
  cwd?: string;
}

const CONFIG_NAMES = [
  "archwall.config.ts",
  "archwall.config.mts",
  "archwall.config.js",
  "archwall.config.mjs",
];

/**
 * One config file, every surface: shared TS/ESM config loading via jiti — never
 * reimplemented per adapter.
 */
export async function loadConfig(
  opts: LoadConfigOptions = {},
): Promise<{ config: UserConfig; configFile: string | null }> {
  const cwd = opts.cwd ?? process.cwd();
  let file: string | null = null;
  if (opts.configPath !== undefined) {
    file = path.resolve(cwd, opts.configPath);
    if (!fs.existsSync(file)) throw new ArchWallError(`Config file not found: ${file}`);
  } else {
    for (const name of CONFIG_NAMES) {
      const candidate = path.join(cwd, name);
      if (fs.existsSync(candidate)) {
        file = candidate;
        break;
      }
    }
  }
  if (file === null) return { config: {}, configFile: null };
  const jiti = createJiti(path.join(cwd, "/"), { interopDefault: true });
  const loaded = await jiti.import(file);
  const config = ((loaded as { default?: UserConfig }).default ?? loaded) as UserConfig;
  return { config, configFile: file };
}
