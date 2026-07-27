import type { Capability } from "../graph/ir.js";
import type { GraphQuery } from "../graph/query.js";
import type { Severity, ViolationInput } from "../violations.js";
import type { GraphComputation } from "./analysis.js";
import type { StandardSchemaV1 } from "./standard-schema.js";

export interface RuleMeta<Options> {
  name: string;
  description: string;
  docsUrl?: string;
  optionsSchema?: StandardSchemaV1<unknown, Options>;
  defaultSeverity: Severity;
  requiredCapabilities?: Capability[];
}

export interface RuleContext<Options> {
  options: Options;
  graph: GraphQuery;
  /**
   * Absolute source root. The base for any path *pattern* a rule matches against, so
   * that rule options read the same way as classifier patterns and `include`/`exclude`.
   */
  sourceRoot: string;
  /**
   * Absolute repository root. For paths a rule puts in front of a human or another tool;
   * reporters relativize against this.
   */
  repoRoot: string;
  /** Shared memoized graph computations, one evaluation per run. */
  compute<T>(computation: GraphComputation<T>): T;
  report(violation: ViolationInput): void;
}

export interface Rule<Options = unknown> {
  meta: RuleMeta<Options>;
  check(ctx: RuleContext<Options>): void | Promise<void>;
}

/**
 * Instance settings, deliberately a SEPARATE bag from the rule's options.
 *
 * These used to be merged into the options object — `configureRule(rule, {...options, id,
 * severity})` — which quietly reserved the names `id` and `severity` across every rule
 * that will ever exist. A rule with a legitimate `severity` option could not be written.
 */
export interface RuleSettings {
  id?: string;
  severity?: Severity | "off";
  scope?: RuleScope;
}

/**
 * Restricts one rule instance to part of the graph.
 *
 * This is what makes a monorepo expressible: "FSD under `apps/web`, layered under
 * `services/api`" is two instances of two rules with two scopes, in ONE config and ONE
 * pass. Without it a monorepo needs N tool invocations with N configs — impossible inside
 * a single bundler build, which is the only place the graph exists.
 *
 * Applied by the ENGINE, by narrowing the `GraphQuery` a rule receives. That is the whole
 * point of putting it here rather than adding a `within` option to each rule: every rule
 * that will ever be written inherits scoping for free, and none of them has to know it
 * exists. Retrofitting this after fifty rules exist means auditing fifty rules.
 */
export interface RuleScope {
  /**
   * Glob-lite paths relative to `sourceRoot`, matched against module files. Default: the
   * whole project.
   */
  include?: string[];
  /** Glob-lite paths to remove from `include`. */
  exclude?: string[];
  /** Only modules carrying ALL of these tags. */
  tag?: Record<string, string>;
}

/**
 * A rule that is also a function returning a configured instance of itself.
 *
 * Every rule used to ship two exports — `noCyclesRule` (the rule) and `noCycles` (the
 * configurator) — via an identical five-line trailer. At eight rules that is 40 lines of
 * boilerplate and a 16-symbol surface where users must learn why both names exist; at
 * fifty it is 250 lines and 100 symbols. One callable object serves both uses.
 */
export interface CallableRule<Options = unknown> extends Rule<Options> {
  (options?: Partial<Options>, settings?: RuleSettings): ConfiguredRule<Options>;
}

export function defineRule<O>(rule: Rule<O>): CallableRule<O> {
  const callable = (options?: Partial<O>, settings?: RuleSettings): ConfiguredRule<O> =>
    configureRule(callable as CallableRule<O>, options, settings);
  return Object.assign(callable, rule) as CallableRule<O>;
}

export interface ConfiguredRule<O = unknown> {
  rule: Rule<O>;
  /**
   * Merge key and `overrides` key. Inside a preset it defaults to
   * `<preset>/<rule.meta.name>`; elsewhere to `rule.meta.name`. Set it explicitly to
   * carry two instances of the same rule in one preset.
   */
  id?: string;
  options?: Partial<O>;
  severity?: Severity | "off";
  /** Restricts this instance to part of the graph; applied by the engine. */
  scope?: RuleScope;
}

export function configureRule<O>(
  rule: Rule<O>,
  options?: Partial<O>,
  settings?: RuleSettings,
): ConfiguredRule<O> {
  return {
    rule,
    options: options ?? ({} as Partial<O>),
    ...(settings?.id !== undefined ? { id: settings.id } : {}),
    ...(settings?.severity !== undefined ? { severity: settings.severity } : {}),
    ...(settings?.scope !== undefined ? { scope: settings.scope } : {}),
  };
}
