import { defineRule } from "@archwall/core";
import { docsUrlFor } from "./docs.js";
import { type ModuleMatcher, moduleMatcherSchema, moduleMatches } from "./matchers.js";
import { arrayOf, object, optional, required, ruleOptions, str } from "./schema.js";

export interface ForbiddenDependencyEntry {
  from: ModuleMatcher;
  to: ModuleMatcher;
  /** Carve-out checked before `to`: matching targets are allowed. */
  except?: ModuleMatcher;
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
    ...docsUrlFor("forbidden-dependencies"),
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
  check(ctx) {
    for (const e of ctx.graph.edges()) {
      const from = ctx.graph.module(e.from);
      const to = ctx.graph.module(e.to);
      if (!from || !to) continue;
      for (const entry of ctx.options.forbid) {
        if (!moduleMatches(from, entry.from) || !moduleMatches(to, entry.to)) continue;
        if (entry.except && moduleMatches(to, entry.except)) continue;
        ctx.report({
          edge: e,
          message:
            entry.message ?? `"${e.from}" may not depend on "${e.to}" (forbidden by matcher)`,
          explanation:
            `Matched forbid entry from=${JSON.stringify(entry.from)} to=${JSON.stringify(entry.to)}` +
            (entry.except
              ? `, and the target is not in except=${JSON.stringify(entry.except)}`
              : "") +
            ".",
        });
      }
    }
  },
});
