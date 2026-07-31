import type { Capability, Edge, ModuleId, ModuleNode } from "../graph/ir.js";
import type { EdgeFilter, GraphQuery, ModuleFilter } from "../graph/query.js";
import type { Severity, ViolationInput } from "../violations.js";
import type { GraphComputation } from "./analysis.js";
import type { StandardSchemaV1 } from "./standard-schema.js";

/**
 * Marks a rule, or one of its options, as on the way out.
 *
 * One optional field, and the only thing standing between the project and a choice
 * between "never rename anything" and "break everyone". The engine turns it into a
 * `rule-deprecated` diagnostic when a deprecated rule is configured.
 */
export interface RuleDeprecation {
  /** Version in which the deprecation was announced. */
  since: string;
  /** Instance id or rule name to migrate to, when there is a direct replacement. */
  replacedBy?: string;
  /** Why, and what to do instead, when `replacedBy` alone does not say it. */
  reason?: string;
  /** Option names that are deprecated, when the rule itself is not. */
  options?: Record<string, string>;
}

export interface RuleMeta<Options> {
  name: string;
  description: string;
  docsUrl?: string;
  optionsSchema?: StandardSchemaV1<unknown, Options>;
  defaultSeverity: Severity;
  requiredCapabilities?: Capability[];
  /**
   * `messageId` → template, with `{placeholder}` interpolation from the reported `data`.
   *
   * Rules report an id and a data bag rather than a finished sentence, so the wording stays
   * a property of the rule's *metadata*: retargetable per instance via
   * `ConfiguredRule.message`, translatable, and machine-groupable.
   */
  messages?: Record<string, string>;
  /** Part of the curated set a "recommended" preset would enable. */
  recommended?: boolean;
  deprecated?: RuleDeprecation;
}

export interface RuleContext<Options> {
  options: Options;
  graph: GraphQuery;
  /**
   * Absolute source root. The base for any path *pattern* a rule matches against, so that
   * rule options read the same way as classifier patterns and `include`/`exclude`.
   */
  sourceRoot: string;
  /**
   * Absolute repository root. For paths a rule puts in front of a human or another tool;
   * reporters relativize against this.
   */
  repoRoot: string;
  /**
   * A file's path relative to {@link sourceRoot}, forward-slashed, or null when it lies
   * outside. Every rule that matches paths needs exactly this, and hand-rolling it is how
   * six copies with three different edge-case behaviours came to exist.
   */
  relative(file: string): string | null;
  /**
   * A module id as a human should read it — `src/domain/rules.ts`, `react`, `node:fs`.
   *
   * Use it for anything that goes into a message's `data`. A canonical {@link ModuleId} is
   * scheme-prefixed, and a rule that interpolates one raw puts `file:src/a.ts` in front of a
   * user.
   */
  display(id: ModuleId): string;
  /**
   * Shared memoized graph computations, one evaluation per run.
   *
   * Scoped like `graph`: a computation requested by a scoped rule is evaluated over that rule's
   * slice.
   */
  compute<T>(computation: GraphComputation<T>): T;
  report(violation: ViolationInput): void;
}

/**
 * What a rule wants to look at, declared rather than fetched.
 *
 * The engine owns the traversal, so one slice of the graph is evaluated once for every rule
 * that wants it, and the engine knows which rules a given edge can affect — the
 * prerequisite for incremental validation.
 *
 * `check` remains for rules that genuinely need the whole graph at once (cycle detection,
 * reachability). It is the exception, not the interface.
 */
export interface RuleVisitors<Options> {
  edges?: {
    /**
     * Narrows the edges `visit` receives. A function of the rule's options, because the
     * interesting filters depend on them (`crossing: options.tagKey`).
     */
    filter?: (options: Options) => EdgeFilter | undefined;
    visit(edge: Edge, ctx: RuleContext<Options>): void;
  };
  modules?: {
    filter?: (options: Options) => ModuleFilter | undefined;
    visit(module: ModuleNode, ctx: RuleContext<Options>): void;
  };
}

export interface Rule<Options = unknown> {
  meta: RuleMeta<Options>;
  /** Declared interest; the engine drives the traversal. Preferred. */
  visits?: RuleVisitors<Options>;
  /** Whole-graph escape hatch, for rules that cannot be expressed as a traversal. */
  check?(ctx: RuleContext<Options>): void | Promise<void>;
}

/**
 * Instance settings, deliberately a SEPARATE bag from the rule's options, so that no
 * option name is reserved across every rule that will ever exist.
 */
export interface RuleSettings {
  id?: string;
  severity?: Severity | "off";
  scope?: RuleScope;
  /**
   * Retargets this instance's wording: one template when the rule has a single message, or
   * `messageId` → template.
   */
  message?: string | Record<string, string>;
}

/**
 * Restricts one rule instance to part of the graph.
 *
 * This is what makes a monorepo expressible: "FSD under `apps/web`, layered under
 * `services/api`" is two instances of two rules with two scopes, in ONE config and ONE
 * pass. Applied by the ENGINE, by narrowing the `GraphQuery` a rule receives, so every
 * rule that will ever be written inherits scoping for free and none of them has to know it
 * exists.
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

/** A rule that is also a function returning a configured instance of itself. */
export interface CallableRule<Options = unknown> extends Rule<Options> {
  (options?: Partial<Options>, settings?: RuleSettings): ConfiguredRule<Options>;
}

export function defineRule<O>(rule: Rule<O>): CallableRule<O> {
  const callable = (options?: Partial<O>, settings?: RuleSettings): ConfiguredRule<O> =>
    configureRule(callable as CallableRule<O>, options, settings);
  return Object.assign(callable, rule) as CallableRule<O>;
}

/**
 * A configured rule instance whose option type is not known at the use site — what a
 * `Preset`, a `UserConfig`, and the engine all hold.
 *
 * `any` rather than `unknown` deliberately: `RuleVisitors` puts `Options` in contravariant
 * position (`filter(options)`, `visit(item, ctx)`), which makes `ConfiguredRule` invariant
 * in `Options`, so `ConfiguredRule<unknown>` would reject every concrete rule there is.
 */
// biome-ignore lint/suspicious/noExplicitAny: see above; invariance makes `unknown` unusable.
export type AnyConfiguredRule = ConfiguredRule<any>;

export interface ConfiguredRule<O = unknown> {
  rule: Rule<O>;
  /**
   * Merge key and `overrides` key. Inside a preset it defaults to
   * `<preset>/<rule.meta.name>`; elsewhere to `rule.meta.name`. Set it explicitly to carry
   * two instances of the same rule in one preset.
   */
  id?: string;
  options?: Partial<O>;
  severity?: Severity | "off";
  /** Restricts this instance to part of the graph; applied by the engine. */
  scope?: RuleScope;
  /** Per-instance message templates; see {@link RuleSettings.message}. */
  message?: string | Record<string, string>;
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
    ...(settings?.message !== undefined ? { message: settings.message } : {}),
  };
}
