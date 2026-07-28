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
    messages: {
      deepImport: 'Deep import "{specifier}" is forbidden',
    },
    optionsSchema: ruleOptions<NoDeepImportsOptions>(
      object({
        forbiddenSpecifiers: required(arrayOf(str)),
        allowedSpecifiers: optional(arrayOf(str)),
      }),
    ),
    // This rule matches ONLY on what the author wrote. Where the host cannot supply that,
    // `rawSpecifier` falls back to the resolved id, every pattern misses, and the rule
    // silently reports nothing. Requiring the capability turns that into a `rule-skipped`
    // diagnostic — the difference between "no deep imports" and "could not check".
    requiredCapabilities: ["raw-specifiers"],
  },
  visits: {
    edges: {
      visit(e, ctx) {
        const { forbiddenSpecifiers, allowedSpecifiers = [] } = ctx.options;
        if (allowedSpecifiers.some((p) => specifierMatches(e.rawSpecifier, p))) return;
        if (!forbiddenSpecifiers.some((p) => specifierMatches(e.rawSpecifier, p))) return;
        ctx.report({
          edge: e,
          messageId: "deepImport",
          data: { specifier: e.rawSpecifier, from: e.from, to: e.to },
          explanation: `Resolves to ${e.resolvedPath}. Import through the module's public entry point instead.`,
        });
      },
    },
  },
});
