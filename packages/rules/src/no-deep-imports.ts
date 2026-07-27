import { defineRule } from "@archwall/core";
import { docsUrlFor } from "./docs.js";
import { specifierMatches } from "./matchers.js";
import { arrayOf, object, optional, required, ruleOptions, str } from "./schema.js";

export interface NoDeepImportsOptions {
  /** Glob-lite patterns matched against the RAW specifier, e.g. "@/features/*\/**". */
  forbiddenSpecifiers: string[];
  /** Exceptions, checked first, e.g. "@/features/*". */
  allowedSpecifiers?: string[];
}

export const noDeepImports = defineRule<NoDeepImportsOptions>({
  meta: {
    name: "no-deep-imports",
    description: "Forbids raw import specifiers that reach past a module's public entry point.",
    defaultSeverity: "error",
    ...docsUrlFor("no-deep-imports"),
    optionsSchema: ruleOptions<NoDeepImportsOptions>(
      object({
        forbiddenSpecifiers: required(arrayOf(str)),
        allowedSpecifiers: optional(arrayOf(str)),
      }),
    ),
    // This rule matches ONLY on what the author wrote. Where the host cannot supply that
    // — Vite dev — `rawSpecifier` falls back to the resolved id, every pattern misses, and
    // the rule silently reports nothing. Requiring the capability turns that into a
    // `rule-skipped` diagnostic, which is the difference between "no deep imports" and
    // "ArchWall could not check for deep imports".
    requiredCapabilities: ["raw-specifiers"],
  },
  check(ctx) {
    const { forbiddenSpecifiers, allowedSpecifiers = [] } = ctx.options;
    for (const e of ctx.graph.edges()) {
      if (allowedSpecifiers.some((p) => specifierMatches(e.rawSpecifier, p))) continue;
      if (!forbiddenSpecifiers.some((p) => specifierMatches(e.rawSpecifier, p))) continue;
      ctx.report({
        edge: e,
        message: `Deep import "${e.rawSpecifier}" is forbidden`,
        explanation: `Resolves to ${e.resolvedPath}. Import through the module's public entry point instead.`,
      });
    }
  },
});
