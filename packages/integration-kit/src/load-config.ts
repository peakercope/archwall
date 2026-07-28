import * as fs from "node:fs";
import * as path from "node:path";
import type { Preset, ReporterSpec, RuleSpec, UserConfig } from "@archwall/core";
import { ArchWallError, isBuiltinReporterName } from "@archwall/core";
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

type Jiti = ReturnType<typeof createJiti>;

/**
 * Imports a module specifier and returns what it exports as its primary value.
 *
 * A plugin package may export its thing as `default`, or under a name matching its purpose;
 * `default` wins, which is the convention every one of these ecosystems settled on.
 */
async function importDefault(jiti: Jiti, specifier: string, from: string): Promise<unknown> {
  const resolved = specifier.startsWith(".")
    ? path.resolve(path.dirname(from), specifier)
    : specifier;
  try {
    const mod = (await jiti.import(resolved)) as Record<string, unknown>;
    return mod?.["default"] ?? mod;
  } catch (err) {
    throw new ArchWallError(
      `Could not load "${specifier}" (referenced from ${from}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Splits `"pkg"` and `["pkg", options]` into their two parts. */
function splitSpec(
  spec: string | readonly unknown[],
): [string, Record<string, unknown> | undefined] {
  if (typeof spec === "string") return [spec, undefined];
  return [String(spec[0]), spec[1] as Record<string, unknown> | undefined];
}

function isNamedSpec(spec: unknown): spec is string | readonly unknown[] {
  return typeof spec === "string" || Array.isArray(spec);
}

/**
 * Merges an inherited config under a deriving one.
 *
 * Arrays concatenate base-first; scalars are replaced by the deriving config; `overrides`
 * merges key-wise with the deriving config winning. Concatenation is right for the arrays
 * because rules already merge by instance id downstream and `overrides` already exists for
 * retuning — a base that contributes rules and a derivation that adds two more is the
 * normal case, and replacement would make `extends` useless for exactly that.
 */
function mergeConfigs(base: UserConfig, derived: UserConfig): UserConfig {
  const concat = <T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined =>
    a === undefined && b === undefined ? undefined : [...(a ?? []), ...(b ?? [])];

  const merged: UserConfig = { ...base, ...derived };
  const presets = concat(base.presets, derived.presets);
  const classifiers = concat(base.classifiers, derived.classifiers);
  const transforms = concat(base.transforms, derived.transforms);
  const rules = concat(base.rules, derived.rules);
  const reporters = concat(base.reporters, derived.reporters);
  const exclude = concat(base.exclude, derived.exclude);

  if (presets !== undefined) merged.presets = presets;
  if (classifiers !== undefined) merged.classifiers = classifiers;
  if (transforms !== undefined) merged.transforms = transforms;
  if (rules !== undefined) merged.rules = rules;
  if (reporters !== undefined) merged.reporters = reporters;
  if (exclude !== undefined) merged.exclude = exclude;
  if (base.overrides !== undefined || derived.overrides !== undefined) {
    merged.overrides = { ...base.overrides, ...derived.overrides };
  }
  // Never inherited: it has already been followed by the time this runs, and leaving it
  // would make `resolveConfig` report an unresolved `extends`.
  delete merged.extends;
  return merged;
}

/** Follows the `extends` chain depth-first, nearest-last, with cycle protection. */
async function flatten(
  config: UserConfig,
  from: string,
  jiti: Jiti,
  seen: Set<string>,
): Promise<UserConfig> {
  const parents =
    config.extends === undefined
      ? []
      : Array.isArray(config.extends)
        ? config.extends
        : [config.extends];

  let base: UserConfig = {};
  for (const parent of parents) {
    const key = parent.startsWith(".") ? path.resolve(path.dirname(from), parent) : parent;
    if (seen.has(key)) {
      throw new ArchWallError(
        `Circular \`extends\`: "${parent}" is already being extended (chain reached it from ${from}).`,
      );
    }
    seen.add(key);
    const loaded = (await importDefault(jiti, parent, from)) as UserConfig;
    base = mergeConfigs(base, await flatten(loaded, key, jiti, seen));
  }

  return mergeConfigs(base, config);
}

/**
 * Turns named presets, rules, and reporters into the objects the engine takes.
 *
 * This is the layer that has a module resolver, which is why name resolution lives here
 * rather than in core: `resolveConfig` must stay synchronous and runnable without a
 * filesystem. A name that survives to the engine is reported there as a config error.
 */
async function materializePlugins(
  config: UserConfig,
  from: string,
  jiti: Jiti,
): Promise<UserConfig> {
  const out: UserConfig = { ...config };

  if (config.presets !== undefined) {
    const presets: Preset[] = [];
    for (const spec of config.presets) {
      if (!isNamedSpec(spec)) {
        presets.push(spec as Preset);
        continue;
      }
      const [name, options] = splitSpec(spec);
      const exported = await importDefault(jiti, name, from);
      const preset = typeof exported === "function" ? exported(options ?? {}) : exported;
      if (preset === null || typeof preset !== "object" || !("rules" in preset)) {
        throw new ArchWallError(
          `"${name}" does not export a preset (expected an object with \`name\`, \`classifiers\`, and \`rules\`, or a function returning one).`,
        );
      }
      presets.push(preset as Preset);
    }
    out.presets = presets;
  }

  if (config.rules !== undefined) {
    const rules: RuleSpec[] = [];
    for (const spec of config.rules) {
      if (!isNamedSpec(spec)) {
        rules.push(spec);
        continue;
      }
      const [name, options] = splitSpec(spec);
      const settings = Array.isArray(spec) ? spec[2] : undefined;
      const exported = await importDefault(jiti, name, from);
      if (typeof exported === "function") {
        rules.push((exported as (o?: unknown, s?: unknown) => RuleSpec)(options ?? {}, settings));
      } else if (exported !== null && typeof exported === "object" && "meta" in exported) {
        // A plain `Rule`, not a `CallableRule`: configure it here.
        rules.push({
          rule: exported as never,
          options: (options ?? {}) as never,
          ...(settings as object),
        });
      } else {
        throw new ArchWallError(
          `"${name}" does not export a rule (expected a rule object with \`meta\`, or a callable rule).`,
        );
      }
    }
    out.rules = rules;
  }

  if (config.reporters !== undefined) {
    const reporters: ReporterSpec[] = [];
    for (const spec of config.reporters) {
      const name =
        typeof spec === "string"
          ? spec
          : typeof spec === "object" &&
              spec !== null &&
              typeof (spec as { reporter?: unknown }).reporter === "string"
            ? (spec as { reporter: string }).reporter
            : undefined;
      if (name === undefined || isBuiltinReporterName(name)) {
        reporters.push(spec);
        continue;
      }
      const exported = await importDefault(jiti, name, from);
      const reporter = typeof exported === "function" ? exported() : exported;
      if (reporter === null || typeof reporter !== "object" || !("onRunEnd" in reporter)) {
        throw new ArchWallError(
          `"${name}" does not export a reporter (expected an object with \`name\` and \`onRunEnd\`, or a factory returning one).`,
        );
      }
      reporters.push(
        typeof spec === "object" && spec !== null && "reporter" in spec
          ? { ...(spec as object), reporter: reporter as never }
          : (reporter as never),
      );
    }
    out.reporters = reporters;
  }

  return out;
}

/**
 * One config file, every surface: shared TS/ESM config loading via jiti — never
 * reimplemented per adapter. Follows `extends` and resolves named plugins, so what comes
 * back is a flat, fully-materialized config the engine can take as-is.
 */
export async function loadConfig(
  opts: LoadConfigOptions = {},
): Promise<{ config: UserConfig; configFile: string | null }> {
  // Absolute: jiti's require anchor must be one, and a caller passing a cwd relative to
  // the process is doing something entirely reasonable.
  const cwd = path.resolve(opts.cwd ?? process.cwd());
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
  const raw = ((loaded as { default?: UserConfig }).default ?? loaded) as UserConfig;
  const flat = await flatten(raw, file, jiti, new Set([file]));
  return { config: await materializePlugins(flat, file, jiti), configFile: file };
}

/**
 * Resolves `extends` and named plugins in a config that did NOT come from a file — an
 * inline config passed to an adapter, or one built programmatically.
 */
export async function materializeConfig(
  config: UserConfig,
  opts: { cwd?: string } = {},
): Promise<UserConfig> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const anchor = path.join(cwd, "archwall.config.ts");
  const jiti = createJiti(path.join(cwd, "/"), { interopDefault: true });
  const flat = await flatten(config, anchor, jiti, new Set());
  return materializePlugins(flat, anchor, jiti);
}
