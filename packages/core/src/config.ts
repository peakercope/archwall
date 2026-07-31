import * as path from "node:path";
import type { Classifier } from "./contracts/classifier.js";
import type { Diagnostic, DiagnosticCode } from "./contracts/diagnostic.js";
import type { Preset } from "./contracts/preset.js";
import type { AnyConfiguredRule, Rule, RuleScope, RuleSettings } from "./contracts/rule.js";
import type { GraphTransform } from "./contracts/transform.js";
import { matchesPattern } from "./match.js";
import type { ReporterSpec } from "./reporters/resolve.js";
import { BUILTIN_REPORTER_NAMES, isBuiltinReporterName } from "./reporters/resolve.js";
import type { Severity } from "./violations.js";

export type FailOn = "error" | "warn" | "never";
export type { BuiltinReporterName, ReporterOutputSpec, ReporterSpec } from "./reporters/resolve.js";

/**
 * Which diagnostics are severe enough to fail the run, independently of violations.
 *
 * `ruleFailed` and `invalidConfig` default to true and should stay that way: a rule that
 * throws, and a rule dropped because its configuration was invalid, both produce no results
 * — so a run in which either happened is a run that did not check what you asked it to. An
 * enforcement tool that passes green when a rule crashes is not an enforcement tool.
 */
export interface FailOnDiagnostics {
  /** A rule threw. Default true. */
  ruleFailed?: boolean;
  /** A rule was skipped for missing host capabilities. Default false. */
  ruleSkipped?: boolean;
  /** Classification tagged nothing, or the boundary matched nothing. Default false. */
  emptyAnalysis?: boolean;
  /**
   * A rule's `scope` resolved to zero modules. Default false.
   *
   * Its own switch rather than part of `emptyAnalysis`: "the run looked at nothing" and "this
   * one rule looked at nothing" are different failures, and a monorepo where some packages
   * legitimately have no modules yet wants to tolerate the second while still gating the first.
   */
  emptyScope?: boolean;
  /** A rule's options failed its schema, so the rule did not run. Default true. */
  invalidOptions?: boolean;
  /** The configuration itself is wrong and something was dropped. Default true. */
  invalidConfig?: boolean;
  /** A configured rule is deprecated. Default false. */
  deprecated?: boolean;
}

export interface ResolvedFailOnDiagnostics {
  ruleFailed: boolean;
  ruleSkipped: boolean;
  emptyAnalysis: boolean;
  emptyScope: boolean;
  invalidOptions: boolean;
  invalidConfig: boolean;
  deprecated: boolean;
}

/**
 * Which diagnostic codes each `failOnDiagnostics` switch governs, and whether it is on by
 * default. The single source of truth for both.
 *
 * One table because there used to be three: the code list lived in `@archwall/integration-kit`,
 * the defaults lived in `resolveConfig` below, and a second copy of the defaults lived beside
 * the code list. Nothing linked them, so adding a gate meant remembering all three, and
 * forgetting the third produced a switch that resolved correctly and then gated nothing.
 *
 * The `satisfies` is what keeps it honest: a key added to {@link ResolvedFailOnDiagnostics}
 * and not here is a compile error, and vice versa.
 */
export const DIAGNOSTIC_GATES = {
  ruleFailed: { codes: ["rule-failed"], default: true },
  ruleSkipped: { codes: ["rule-skipped"], default: false },
  emptyAnalysis: { codes: ["no-modules-classified", "empty-project"], default: false },
  emptyScope: { codes: ["empty-scope"], default: false },
  invalidOptions: { codes: ["invalid-rule-options"], default: true },
  invalidConfig: { codes: ["invalid-config"], default: true },
  deprecated: { codes: ["rule-deprecated"], default: false },
} as const satisfies Record<
  keyof ResolvedFailOnDiagnostics,
  { codes: readonly DiagnosticCode[]; default: boolean }
>;

const GATE_KEYS = Object.keys(DIAGNOSTIC_GATES) as (keyof ResolvedFailOnDiagnostics)[];

/**
 * Applies {@link DIAGNOSTIC_GATES}' defaults to whatever the user left unset.
 *
 * Spelled out key by key rather than mapped over `GATE_KEYS`, so that adding a gate is a
 * compile error here until it is handled. The values still come from the one table; only the
 * exhaustiveness is restated, and restating it is the thing being bought.
 */
export function resolveFailOnDiagnostics(
  user: FailOnDiagnostics | undefined,
): ResolvedFailOnDiagnostics {
  const gate = (key: keyof ResolvedFailOnDiagnostics): boolean =>
    user?.[key] ?? DIAGNOSTIC_GATES[key].default;
  return {
    ruleFailed: gate("ruleFailed"),
    ruleSkipped: gate("ruleSkipped"),
    emptyAnalysis: gate("emptyAnalysis"),
    emptyScope: gate("emptyScope"),
    invalidOptions: gate("invalidOptions"),
    invalidConfig: gate("invalidConfig"),
    deprecated: gate("deprecated"),
  };
}

/** The diagnostic codes that should fail a run, given the resolved gates. */
export function failingDiagnosticCodes(gates: ResolvedFailOnDiagnostics): Set<DiagnosticCode> {
  return new Set(
    GATE_KEYS.filter((key) => gates[key]).flatMap((key) => DIAGNOSTIC_GATES[key].codes),
  );
}

/**
 * Retune one rule instance. The shorthand form sets severity only; the object form can also
 * patch options, scope, and wording.
 *
 * Options merge by ONE policy, the same one used everywhere: **top-level keys replace, and
 * arrays are replaced wholesale, never concatenated.**
 */
export type RuleOverride =
  | Severity
  | "off"
  | {
      severity?: Severity | "off";
      options?: Record<string, unknown>;
      scope?: RuleScope;
      message?: string | Record<string, string>;
    };

/**
 * A preset, or the name of a package exporting one.
 *
 * The string form is what makes a plugin ecosystem possible: without it a preset can only
 * be `import`ed, which forecloses JSON/YAML configuration and any `--preset` flag forever.
 * Strings are resolved by the config loader (`@archwall/integration-kit`), which is the
 * layer that has a module resolver; one that reaches {@link resolveConfig} unresolved is
 * reported as a configuration error rather than silently ignored.
 *
 * `["@acme/preset", { … }]` calls the package's default export with those options.
 */
export type PresetSpec = Preset | string | readonly [string, Record<string, unknown>?];

/** A configured rule, or the name of a package/built-in exporting one. See {@link PresetSpec}. */
export type RuleSpec =
  | AnyConfiguredRule
  | string
  | readonly [string, Record<string, unknown>?, RuleSettings?];

export interface UserConfig {
  /**
   * Configurations to inherit from, nearest-last: a later entry wins over an earlier one,
   * and this config wins over all of them.
   *
   * Arrays (`presets`, `rules`, `classifiers`, `transforms`, `reporters`, `exclude`)
   * CONCATENATE base-first, because rules already merge by instance id downstream and
   * `overrides` already exists for retuning. Scalars replace. `overrides` merges key-wise.
   *
   * This is the only way to ship an organisation-wide configuration: a `Preset` cannot set
   * `failOn`, `include`, `exclude`, `repoRoot`, or `reporters`, so without `extends` a
   * shared config is a preset plus a README telling every repository to copy twenty lines.
   */
  extends?: string | string[];
  /**
   * Where the *repository* starts, relative to the config file / cwd. Default ".".
   *
   * The base for everything that leaves the process — reporter output, SARIF
   * `artifactLocation.uri`, violation fingerprints — so it must be the path a checkout is
   * rooted at, not the path your sources happen to live under.
   */
  repoRoot?: string;
  /**
   * Where the *sources* start, relative to {@link repoRoot}. Default ".".
   *
   * The base for `include`/`exclude` matching and for classifier patterns — the tree whose
   * shape your architecture is described in. This is the one that is usually `"src"`.
   */
  sourceRoot?: string;
  include?: string[];
  /**
   * Patterns ADDED to the defaults (`node_modules`, `*.test.*`, `*.spec.*`), not a
   * replacement for them. Use {@link excludeDefaults} to opt out deliberately.
   */
  exclude?: string[];
  /** Set false to drop the built-in `exclude` defaults entirely. */
  excludeDefaults?: boolean;
  presets?: PresetSpec[];
  /** Appended after preset classifiers. */
  classifiers?: Classifier[];
  /** Appended after preset transforms; run between the project boundary and classification. */
  transforms?: GraphTransform[];
  /** Merged after preset rules (last-writer-wins, keyed by rule instance id). */
  rules?: RuleSpec[];
  /**
   * Retunes rule instances; ALWAYS wins over presets and rules. Keys are an exact instance
   * id ("fsd/public-api"), a bare rule name (every instance of it), or a glob ("fsd/*").
   * A key that matches no rule is an error, not a silent no-op.
   */
  overrides?: Record<string, RuleOverride>;
  /**
   * Built-ins by name, customs by object, third-party by package name, and
   * `{ reporter, output }` to send one somewhere other than stdout. Default ["console"].
   */
  reporters?: ReporterSpec[];
  /** Which VIOLATION severity gates the run. `info` findings never fail it. */
  failOn?: FailOn;
  /** Which DIAGNOSTICS gate the run, regardless of `failOn`. */
  failOnDiagnostics?: FailOnDiagnostics;
}

export function defineConfig(config: UserConfig): UserConfig {
  return config;
}

export interface ResolvedRule {
  rule: Rule<any>;
  /** Instance id; what violations report and what `overrides` keys match. */
  id: string;
  options: unknown;
  severity: Severity;
  /** Narrows the graph this instance sees; applied by the engine, never by the rule. */
  scope?: RuleScope;
  /** Per-instance message templates. */
  message?: string | Record<string, string>;
}

export interface ResolvedConfig {
  /** Absolute. Base for reported paths and fingerprints. */
  repoRoot: string;
  /** Absolute, at or below {@link repoRoot}. Base for the boundary and classifiers. */
  sourceRoot: string;
  include: string[];
  exclude: string[];
  classifiers: readonly Classifier[];
  transforms: readonly GraphTransform[];
  rules: readonly ResolvedRule[];
  /** Reporter instantiation is deferred to the run edge (resolveReporters). */
  reporterSpecs: readonly ReporterSpec[];
  failOn: FailOn;
  failOnDiagnostics: ResolvedFailOnDiagnostics;
  /**
   * Everything wrong with the configuration itself, found before any graph work.
   *
   * Reported rather than thrown: a throw inside a bundler's `buildEnd` produces a stack
   * trace and destroys every other finding in the run. One mistyped `overrides` key costs
   * you that key, not the analysis — and `failOnDiagnostics.invalidConfig` still fails the
   * run. See docs/adr/0007-config-errors-as-diagnostics.md.
   */
  diagnostics: readonly Diagnostic[];
}

/**
 * Everything under `sourceRoot`, deliberately — NOT an extension allow-list.
 *
 * `include`/`exclude` are applied to the graph, where the compiler has already decided what
 * counts as a module. Re-filtering by extension there would silently drop every `.vue`,
 * `.svelte`, `.astro`, and `.mts` module the host legitimately compiled. Deciding *which
 * files to open and parse* belongs to the one surface that enumerates a directory tree: the
 * CLI's scanner keeps its own list of extensions it can lex.
 */
const DEFAULT_INCLUDE = ["**"];
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/*.test.*", "**/*.spec.*"];

function configError(message: string, ruleId?: string): Diagnostic {
  return {
    code: "invalid-config",
    severity: "error",
    ...(ruleId !== undefined ? { ruleId } : {}),
    message,
  };
}

interface IdentifiedRule {
  configured: AnyConfiguredRule;
  id: string;
}

/**
 * Namespacing preset rules is what makes `presets: [a(), b()]` safe: without it two presets
 * configuring the same rule collide on one key and shallow-merge their options.
 *
 * …which only works if the names are actually distinct. Two instances of one preset — the
 * natural way to describe a monorepo — would produce identical ids, the same collision
 * arrived at from the other direction, so a duplicate name is reported and the later preset
 * is namespaced apart rather than silently merged.
 */
function withIds(
  presets: readonly Preset[],
  userRules: readonly AnyConfiguredRule[],
  diagnostics: Diagnostic[],
): IdentifiedRule[] {
  const namespaces = new Map<string, number>();
  const preset: IdentifiedRule[] = [];
  for (const p of presets) {
    const seen = namespaces.get(p.name) ?? 0;
    namespaces.set(p.name, seen + 1);
    let namespace = p.name;
    if (seen > 0) {
      namespace = `${p.name}#${seen + 1}`;
      diagnostics.push(
        configError(
          `Two presets are both named "${p.name}", so their rules would collide on the same ids and ` +
            `silently merge their options. The later one's rules were namespaced "${namespace}/…" instead. ` +
            `Give it a distinct name, or configure its rules explicitly with their own \`id\`s.`,
        ),
      );
    }
    for (const r of p.rules) {
      preset.push({ configured: r, id: r.id ?? `${namespace}/${r.rule.meta.name}` });
    }
  }

  const own: IdentifiedRule[] = [];
  for (const r of userRules) {
    if (r.id !== undefined) {
      own.push({ configured: r, id: r.id });
      continue;
    }
    const name = r.rule.meta.name;
    // A bare user rule tunes the preset's instance rather than adding a second one — two
    // instances of the same rule would report every violation twice.
    const fromPresets = preset.filter((p) => p.configured.rule.meta.name === name);
    if (fromPresets.length === 1) {
      own.push({ configured: r, id: fromPresets[0]!.id });
    } else if (fromPresets.length > 1) {
      diagnostics.push(
        configError(
          `Rule "${name}" is configured by more than one preset (${fromPresets.map((p) => p.id).join(", ")}), ` +
            `so a bare rules[] entry is ambiguous and was dropped. Give it an explicit \`id\`, or use \`overrides\` to target one.`,
        ),
      );
    } else {
      own.push({ configured: r, id: name });
    }
  }

  return [...preset, ...own];
}

/**
 * THE options-merge policy. One rule, applied identically everywhere two option bags meet:
 * preset over preset, `rules[]` over preset, and `overrides.options` over both.
 *
 * **Top-level keys replace. Nothing is deep-merged, and arrays are never concatenated.**
 * Arrays here are values, not collections: `layers: ["ui", "domain"]` describes a total
 * order and `forbid: [...]` a complete policy. Replacement is the only rule that lets an
 * override *remove* something.
 */
function mergeRuleOptions(
  base: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return { ...base, ...patch };
}

/**
 * Validates one rule's options against its `optionsSchema`, at CONFIG time.
 *
 * A bad options bag is a configuration mistake: it is known before any graph work happens,
 * it cannot be fixed by re-running, and it should be reported once, as a diagnostic,
 * alongside everything else wrong with the config.
 *
 * Schemas must validate synchronously. An async schema is not rejected as invalid — it is
 * reported as unusable, which is a different and more accurate complaint.
 */
function validateOptions(
  rule: Rule<any>,
  id: string,
  options: Record<string, unknown>,
): { value: unknown; diagnostic?: undefined } | { value?: undefined; diagnostic: Diagnostic } {
  const schema = rule.meta.optionsSchema;
  if (!schema) return { value: options };

  const result = schema["~standard"].validate(options);
  if (result instanceof Promise) {
    return {
      diagnostic: {
        code: "invalid-rule-options",
        severity: "error",
        ruleId: id,
        message:
          `Rule "${id}" has an asynchronous \`optionsSchema\`, which cannot be evaluated while resolving ` +
          `configuration. Use a synchronous schema.`,
      },
    };
  }
  if (result.issues) {
    const detail = result.issues.map((i) => i.message).join("; ");
    return {
      diagnostic: {
        code: "invalid-rule-options",
        severity: "error",
        ruleId: id,
        message: `Invalid options for rule "${id}": ${detail}`,
        details: { issues: result.issues.map((i) => i.message) },
      },
    };
  }
  return { value: result.value };
}

/** Splits materialized entries from string specs the loader was supposed to resolve. */
function materialized<T extends object, S>(
  specs: readonly (T | S)[],
  what: string,
  diagnostics: Diagnostic[],
): T[] {
  const out: T[] = [];
  for (const spec of specs) {
    if (typeof spec === "string" || Array.isArray(spec)) {
      const name = typeof spec === "string" ? spec : String((spec as unknown[])[0]);
      diagnostics.push(
        configError(
          `${what} "${name}" was given as a name, but nothing resolved it to a module. ` +
            `Named ${what.toLowerCase()}s are resolved when the config is loaded from a file; ` +
            `if you are calling resolveConfig() directly, pass the imported object instead.`,
        ),
      );
      continue;
    }
    out.push(spec as T);
  }
  return out;
}

export function resolveConfig(user: UserConfig, opts?: { cwd?: string }): ResolvedConfig {
  const cwd = opts?.cwd ?? process.cwd();
  const diagnostics: Diagnostic[] = [];

  if ("root" in user) {
    diagnostics.push(
      configError(
        "`root` has been split into `repoRoot` (base for reported paths, SARIF, and fingerprints) " +
          "and `sourceRoot` (base for include/exclude and classifier patterns). " +
          'A config that used `root: "src"` almost certainly wants `sourceRoot: "src"` with `repoRoot` left at its default.',
      ),
    );
  }
  if (user.extends !== undefined) {
    diagnostics.push(
      configError(
        "`extends` was not resolved. It is followed when the config is loaded from a file; " +
          "resolveConfig() receives an already-flattened config.",
      ),
    );
  }

  const presets = materialized<Preset, string | readonly unknown[]>(
    user.presets ?? [],
    "Preset",
    diagnostics,
  );
  const userRules = materialized<AnyConfiguredRule, string | readonly unknown[]>(
    user.rules ?? [],
    "Rule",
    diagnostics,
  );

  interface Entry {
    rule: Rule<any>;
    scope?: RuleScope;
    options: Record<string, unknown>;
    severity?: Severity | "off";
    message?: string | Record<string, string>;
  }
  const merged = new Map<string, Entry>();
  for (const { configured, id } of withIds(presets, userRules, diagnostics)) {
    const prev = merged.get(id);
    const severity = configured.severity ?? prev?.severity;
    // Scope replaces rather than merges, for the same reason array options do: a scope is
    // one complete description of where a rule applies, and a merged one is a place neither
    // author asked for.
    const scope = configured.scope ?? prev?.scope;
    const message = configured.message ?? prev?.message;
    merged.set(id, {
      rule: configured.rule,
      options: mergeRuleOptions(
        prev?.options,
        configured.options as Record<string, unknown> | undefined,
      ),
      ...(severity !== undefined ? { severity } : {}),
      ...(scope !== undefined ? { scope } : {}),
      ...(message !== undefined ? { message } : {}),
    });
  }

  for (const [key, override] of Object.entries(user.overrides ?? {})) {
    const targets = [...merged.entries()].filter(
      ([id, entry]) => id === key || entry.rule.meta.name === key || matchesPattern(id, key),
    );
    if (targets.length === 0) {
      const known = [...merged.keys()].sort().join(", ");
      diagnostics.push(
        configError(
          `Override key "${key}" matches no configured rule and was ignored. Configured rules: ${known || "(none)"}.`,
        ),
      );
      continue;
    }
    const patch = typeof override === "string" ? { severity: override } : override;
    for (const [, entry] of targets) {
      if (patch.severity !== undefined) entry.severity = patch.severity;
      if (patch.options !== undefined)
        entry.options = mergeRuleOptions(entry.options, patch.options);
      if (patch.scope !== undefined) entry.scope = patch.scope;
      if (patch.message !== undefined) entry.message = patch.message;
    }
  }

  const rules: ResolvedRule[] = [];
  for (const [id, entry] of merged) {
    const severity = entry.severity ?? entry.rule.meta.defaultSeverity;
    if (severity === "off") continue;
    const validated = validateOptions(entry.rule, id, entry.options);
    if (validated.diagnostic !== undefined) {
      // A rule whose options are invalid cannot run correctly, so it does not run at all.
      // Dropping it loudly beats running it on a bad options bag and reporting nonsense.
      diagnostics.push(validated.diagnostic);
      continue;
    }
    rules.push({
      rule: entry.rule,
      id,
      options: validated.value,
      severity,
      ...(entry.scope !== undefined ? { scope: entry.scope } : {}),
      ...(entry.message !== undefined ? { message: entry.message } : {}),
    });
  }

  const reporterSpecs: ReporterSpec[] = [];
  for (const spec of [
    ...(user.reporters ?? ["console"]),
    ...presets.flatMap((p) => p.reporters ?? []),
  ]) {
    const name =
      typeof spec === "string"
        ? spec
        : typeof (spec as { reporter?: unknown }).reporter === "string"
          ? (spec as { reporter: string }).reporter
          : undefined;
    if (name !== undefined && !isBuiltinReporterName(name)) {
      diagnostics.push(
        configError(
          `Reporter "${name}" is not a built-in (${BUILTIN_REPORTER_NAMES.join(", ")}) and nothing resolved it ` +
            `to a module, so it was dropped. Named reporters are resolved when the config is loaded from a file.`,
        ),
      );
      continue;
    }
    reporterSpecs.push(spec);
  }

  const repoRoot = path.resolve(cwd, user.repoRoot ?? ".");

  return {
    repoRoot,
    // Relative to the repo root, not to cwd: the two roots describe one nested tree, and
    // resolving them independently would let them drift apart under a different cwd.
    sourceRoot: path.resolve(repoRoot, user.sourceRoot ?? "."),
    include: user.include ?? [...DEFAULT_INCLUDE],
    // MERGED, not replaced. Adding one pattern must not silently re-admit node_modules and
    // every test file in the project.
    exclude: [...(user.excludeDefaults === false ? [] : DEFAULT_EXCLUDE), ...(user.exclude ?? [])],
    classifiers: [...presets.flatMap((p) => p.classifiers), ...(user.classifiers ?? [])],
    transforms: [...presets.flatMap((p) => p.transforms ?? []), ...(user.transforms ?? [])],
    rules,
    reporterSpecs,
    failOn: user.failOn ?? "error",
    failOnDiagnostics: resolveFailOnDiagnostics(user.failOnDiagnostics),
    diagnostics,
  };
}
