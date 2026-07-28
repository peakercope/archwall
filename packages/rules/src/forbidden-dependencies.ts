import { defineRule } from "@archwall/core";
import { docsUrlFor } from "./docs.js";
import { type ModuleMatcher, moduleMatcherSchema, moduleMatches } from "./matchers.js";
import { arrayOf, object, optional, required, ruleOptions, str } from "./schema.js";

export interface ForbiddenDependencyEntry {
  from: ModuleMatcher;
  to: ModuleMatcher;
  /** Carve-out checked before `to`: matching targets are allowed. */
  except?: ModuleMatcher;
  /**
   * Wording for THIS entry.
   *
   * Kept, unlike the per-rule `message` options that `ConfiguredRule.message` replaced:
   * this varies per forbid entry, not per rule instance, and instance-level templating
   * cannot express "a different sentence for each of nine policies in one list".
   */
  message?: string;
}

export interface ForbiddenDependenciesOptions {
  forbid: ForbiddenDependencyEntry[];
}

export const forbiddenDependencies = defineRule<ForbiddenDependenciesOptions>({
  meta: {
    name: "forbidden-dependencies",
    description: "Forbids dependencies between modules matching configured from/to matchers.",
    defaultSeverity: "error",
    recommended: true,
    ...docsUrlFor("forbidden-dependencies"),
    messages: {
      forbidden: '"{from}" may not depend on "{to}" (forbidden by matcher)',
    },
    optionsSchema: ruleOptions<ForbiddenDependenciesOptions>(
      object({
        forbid: required(
          arrayOf(
            object({
              from: required(moduleMatcherSchema),
              to: required(moduleMatcherSchema),
              except: optional(moduleMatcherSchema),
              message: optional(str),
            }),
          ),
        ),
      }),
    ),
  },
  visits: {
    edges: {
      // No filter: the matchers are arbitrary, so every edge is a candidate. The engine
      // still hands over the graph's own edge array without copying it.
      visit(e, ctx) {
        const from = ctx.graph.module(e.from);
        const to = ctx.graph.module(e.to);
        if (!from || !to) return;
        for (const entry of ctx.options.forbid) {
          if (!moduleMatches(from, entry.from) || !moduleMatches(to, entry.to)) continue;
          if (entry.except && moduleMatches(to, entry.except)) continue;
          ctx.report({
            edge: e,
            ...(entry.message !== undefined
              ? { message: entry.message }
              : { messageId: "forbidden" }),
            data: { from: e.from, to: e.to },
            explanation:
              `Matched forbid entry from=${JSON.stringify(entry.from)} to=${JSON.stringify(entry.to)}` +
              (entry.except
                ? `, and the target is not in except=${JSON.stringify(entry.except)}`
                : "") +
              ".",
          });
        }
      },
    },
  },
});
