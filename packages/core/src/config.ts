import * as path from "node:path";
import type { Classifier } from "./contracts/classifier.js";
import type { Diagnostic } from "./contracts/diagnostic.js";
import type { Preset } from "./contracts/preset.js";
import type { Reporter } from "./contracts/reporter.js";
import type { ConfiguredRule, Rule, RuleScope } from "./contracts/rule.js";
import type { GraphTransform } from "./contracts/transform.js";
import { ArchWallError } from "./errors.js";
import { matchesPattern } from "./match.js";
import type { Severity } from "./violations.js";

export type FailOn = "error" | "warn" | "never";
export type BuiltinReporterName = "console" | "json" | "sarif";

/**
 * Which diagnostics are severe enough to fail the run, independently of violations.
 *
 * `rule-failed` defaults to true and should stay that way: a rule that throws produces no
 * results, so a run in which one crashed is a run that did not check what you asked it to.
 * An enforcement tool that passes green when a rule crashes is not an enforcement tool.
 */
export interface FailOnDiagnostics {
  /** A rule threw. Default true. */
  ruleFailed?: boolean;
  /** A rule was skipped for missing host capabilities. Default false. */
  ruleSkipped?: boolean;
  /** Classification tagged nothing, or the boundary matched nothing. Default false. */
  emptyAnalysis?: boolean;
  /** A rule's options failed its schema, so the rule did not run. Default true. */
  invalidOptions?: boolean;
}

export interface ResolvedFailOnDiagnostics {
  ruleFailed: boolean;
  ruleSkipped: boolean;
  emptyAnalysis: boolean;
  invalidOptions: boolean;
}

/**
 * Retune one rule instance. The shorthand form sets severity only; the object form can
 * also patch options.
 *
 * Options merge by ONE policy, the same one used everywhere: **top-level keys replace, and
 * arrays are replaced wholesale, never concatenated.** So `options: { layers: ["a", "b"] }`
 * gives the rule exactly that layer order — it does not append to the preset's.
 */
export type RuleOverride =
  | Severity
  | "off"
  | {
      severity?: Severity | "off";
      options?: Record<string, unknown>;
      scope?: RuleScope;
    };

export interface UserConfig {
  /**
   * Where the *repository* starts, relative to the config file / cwd. Default ".".
   *
   * This is the base for everything that leaves the process — reporter output, SARIF
   * `artifactLocation.uri`, violation fingerprints — so it must be the path a checkout
   * is rooted at, not the path your sources happen to live under. Pointing it at `src/`
   * emits `features/x.ts` where consumers expect `src/features/x.ts`, and GitHub code
   * scanning cannot associate that with a file in the repository.
   */
  repoRoot?: string;
  /**
   * Where the *sources* start, relative to {@link repoRoot}. Default ".".
   *
   * This is the base for `include`/`exclude` matching and for `pathClassifier` patterns
   * — i.e. the tree whose shape your architecture is described in. This is the one that
   * is usually `"src"`.
   */
  sourceRoot?: string;
  include?: string[];
  /**
   * Patterns ADDED to the defaults (`node_modules`, `*.test.*`, `*.spec.*`), not a
   * replacement for them.
   *
   * Replacing was the old behaviour and a classic trap: `exclude: ["**\/*.stories.*"]`
   * silently re-admitted every test file, and the resulting violations looked like a
   * change in your architecture rather than in your config. Use {@link excludeDefaults}
   * to opt out of the defaults deliberately.
   */
  exclude?: string[];
  /**
   * Set false to drop the built-in `exclude` defaults entirely. Opting out is fine; doing
   * it by accident is not, which is why it takes a second field to say so.
   */
  excludeDefaults?: boolean;
  presets?: Preset[];
  /** Appended after preset classifiers. */
  classifiers?: Classifier[];
  /** Appended after preset transforms; run between the project boundary and classification. */
  transforms?: GraphTransform[];
  /** Merged after preset rules (last-writer-wins, keyed by rule instance id). */
  rules?: ConfiguredRule[];
  /**
   * Retunes rule instances; ALWAYS wins over presets and rules. Keys are an exact
   * instance id ("fsd/public-api"), a bare rule name (every instance of it), or a glob
   * ("fsd/*"). A key that matches no rule is an error, not a silent no-op.
   */
  overrides?: Record<string, RuleOverride>;
  /** Built-ins by name; customs by object. Default ["console"]. */
  reporters?: (BuiltinReporterName | Reporter)[];
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
  reporterSpecs: readonly (BuiltinReporterName | Reporter)[];
  failOn: FailOn;
  failOnDiagnostics: ResolvedFailOnDiagnostics;
  /**
   * Everything wrong with the configuration itself, found before any graph work. The
   * engine forwards these into `AnalysisResult.diagnostics` so they reach reporters and
   * the exit status through the one channel every other diagnostic uses.
   */
  diagnostics: readonly Diagnostic[];
}

/**
 * Everything under `root`, deliberately — NOT an extension allow-list.
 *
 * `include`/`exclude` describe the shape of your project and are applied to the graph,
 * where the compiler has already decided what counts as a module. Re-filtering by
 * extension there would silently drop every `.vue`, `.svelte`, `.astro`, and `.mts`
 * module the host legitimately compiled.
 *
 * Deciding *which files to open and parse* is a different question, and it belongs to
 * the one surface that enumerates a directory tree rather than reading a graph: the
 * CLI's scanner keeps its own list of extensions it can lex.
 */
const DEFAULT_INCLUDE = ["**"];
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/*.test.*", "**/*.spec.*"];

/**
 * Namespacing preset rules is what makes `presets: [a(), b()]` safe: without it two
 * presets configuring the same rule would collide on one key and shallow-merge their
 * options, silently overwriting each other's layer lists.
 */
function withIds(presets: readonly Preset[], userRules: readonly ConfiguredRule[]) {
  // …which namespacing only achieves if the names are actually distinct. Two instances of
  // one preset — `presets: [fsd(), fsd({ src: "packages/b" })]`, the natural way to describe
  // a monorepo — produce identical ids and shallow-merge their options, which is exactly the
  // collision namespacing exists to prevent, arrived at from the other direction.
  const seen = new Set<string>();
  for (const p of presets) {
    if (seen.has(p.name)) {
      throw new ArchWallError(
        `Two presets are both named "${p.name}", so their rules would collide on the same ids and ` +
          `silently merge their options. Give one a distinct name (presets accept a \`name\` via ` +
          `\`definePreset\`), or configure the second one's rules explicitly with their own \`id\`s.`,
      );
    }
    seen.add(p.name);
  }

  const preset = presets.flatMap((p) =>
    p.rules.map((r) => ({
      configured: r,
      id: r.id ?? `${p.name}/${r.rule.meta.name}`,
    })),
  );

  const own = userRules.map((r) => {
    if (r.id !== undefined) return { configured: r, id: r.id };
    const name = r.rule.meta.name;
    // A bare user rule tunes the preset's instance rather than adding a second one —
    // two instances of the same rule would report every violation twice.
    const fromPresets = preset.filter((p) => p.configured.rule.meta.name === name);
    if (fromPresets.length === 1) return { configured: r, id: fromPresets[0]!.id };
    if (fromPresets.length > 1) {
      throw new ArchWallError(
        `Rule "${name}" is configured by more than one preset (${fromPresets.map((p) => p.id).join(", ")}), ` +
          `so a bare rules[] entry is ambiguous. Give the entry an explicit \`id\`, or use \`overrides\` to target one.`,
      );
    }
    return { configured: r, id: name };
  });

  return [...preset, ...own];
}

/**
 * THE options-merge policy. One rule, applied identically everywhere two option bags meet:
 * preset over preset, `rules[]` over preset, and `overrides.options` over both.
 *
 * **Top-level keys replace. Nothing is deep-merged, and arrays are never concatenated.**
 *
 * Arrays here are values, not collections: `layers: ["ui", "domain"]` describes a total
 * order and `forbid: [...]` a complete policy. Appending to either produces something the
 * author never wrote — a layer order with duplicates, or a forbid list you cannot shrink.
 * Replacement is the only rule that lets an override *remove* something.
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
 * This used to run inside the rule loop in `analyze()`, once per run, and it *threw* — from
 * a line that sat outside the per-rule `try/catch` two lines below it, so a schema failure
 * in rule 3 destroyed rules 4 through 40. A bad options bag is a configuration mistake: it
 * is known before any graph work happens, it cannot be fixed by re-running, and it should
 * be reported once, as a diagnostic, alongside every other thing wrong with the config.
 *
 * Schemas must validate synchronously here. An async schema is not rejected as invalid —
 * it is reported as unusable, which is a different and more accurate complaint.
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

export function resolveConfig(user: UserConfig, opts?: { cwd?: string }): ResolvedConfig {
  const cwd = opts?.cwd ?? process.cwd();
  const presets = user.presets ?? [];

  // `root` used to mean both roots at once, and the documented value ("./src") was right
  // for one and wrong for the other. Silently reinterpreting it either way would change
  // results without telling anyone, so it is an error with a migration in the message.
  if ("root" in user) {
    throw new ArchWallError(
      "`root` has been split into `repoRoot` (base for reported paths, SARIF, and fingerprints) " +
        "and `sourceRoot` (base for include/exclude and classifier patterns). " +
        'A config that used `root: "src"` almost certainly wants `sourceRoot: "src"` with `repoRoot` left at its default.',
    );
  }

  interface Entry {
    rule: Rule<any>;
    scope?: RuleScope;
    options: Record<string, unknown>;
    severity?: Severity | "off";
  }
  const merged = new Map<string, Entry>();
  for (const { configured, id } of withIds(presets, user.rules ?? [])) {
    const prev = merged.get(id);
    const severity = configured.severity ?? prev?.severity;
    // Scope replaces rather than merges, for the same reason array options do: a scope is
    // one complete description of where a rule applies, and a merged one is a place
    // neither author asked for.
    const scope = configured.scope ?? prev?.scope;
    merged.set(id, {
      rule: configured.rule,
      options: mergeRuleOptions(
        prev?.options,
        configured.options as Record<string, unknown> | undefined,
      ),
      ...(severity !== undefined ? { severity } : {}),
      ...(scope !== undefined ? { scope } : {}),
    });
  }

  for (const [key, override] of Object.entries(user.overrides ?? {})) {
    const targets = [...merged.entries()].filter(
      ([id, entry]) => id === key || entry.rule.meta.name === key || matchesPattern(id, key),
    );
    if (targets.length === 0) {
      const known = [...merged.keys()].sort().join(", ");
      throw new ArchWallError(
        `Override key "${key}" matches no configured rule. Configured rules: ${known || "(none)"}.`,
      );
    }
    const patch = typeof override === "string" ? { severity: override } : override;
    for (const [, entry] of targets) {
      if (patch.severity !== undefined) entry.severity = patch.severity;
      if (patch.options !== undefined)
        entry.options = mergeRuleOptions(entry.options, patch.options);
      if (patch.scope !== undefined) entry.scope = patch.scope;
    }
  }

  const rules: ResolvedRule[] = [];
  const diagnostics: Diagnostic[] = [];
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
    });
  }

  const repoRoot = path.resolve(cwd, user.repoRoot ?? ".");

  return {
    repoRoot,
    // Relative to the repo root, not to cwd: the two roots describe one nested tree, and
    // resolving them independently would let them drift apart under a different cwd.
    sourceRoot: path.resolve(repoRoot, user.sourceRoot ?? "."),
    include: user.include ?? [...DEFAULT_INCLUDE],
    // MERGED, not replaced. Adding one pattern must not silently re-admit node_modules
    // and every test file in the project.
    exclude: [...(user.excludeDefaults === false ? [] : DEFAULT_EXCLUDE), ...(user.exclude ?? [])],
    classifiers: [...presets.flatMap((p) => p.classifiers), ...(user.classifiers ?? [])],
    transforms: [...presets.flatMap((p) => p.transforms ?? []), ...(user.transforms ?? [])],
    rules,
    // Preset reporters are APPENDED, never a replacement: a preset that ships an uploader
    // must not silently remove the console output the user is actually reading.
    reporterSpecs: [
      ...(user.reporters ?? ["console"]),
      ...presets.flatMap((p) => p.reporters ?? []),
    ],
    failOn: user.failOn ?? "error",
    failOnDiagnostics: {
      ruleFailed: user.failOnDiagnostics?.ruleFailed ?? true,
      ruleSkipped: user.failOnDiagnostics?.ruleSkipped ?? false,
      emptyAnalysis: user.failOnDiagnostics?.emptyAnalysis ?? false,
      invalidOptions: user.failOnDiagnostics?.invalidOptions ?? true,
    },
    diagnostics,
  };
}
