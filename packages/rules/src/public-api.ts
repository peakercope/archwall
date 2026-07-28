import { defineRule } from "@archwall/core";
import { docsUrlFor } from "./docs.js";
import { arrayOf, object, optional, ruleOptions, str } from "./schema.js";

export interface PublicApiOptions {
  /** Default "visibility". */
  visibilityTagKey?: string;
  /** Default "internal". */
  internalValue?: string;
  /**
   * An import INTO an internal module is legal only when importer and target agree on ALL
   * of these tags (undefined === undefined counts as agreement). Default ["layer", "slice"].
   */
  scopeTagKeys?: string[];
}

export const publicApi = defineRule<PublicApiOptions>({
  meta: {
    name: "public-api",
    description:
      "Enforces module entry points: internal modules may only be imported from within their own scope.",
    defaultSeverity: "error",
    recommended: true,
    ...docsUrlFor("public-api"),
    messages: {
      internalFromOutside: '"{from}" may not import internal module "{to}" from outside its scope',
    },
    optionsSchema: ruleOptions<PublicApiOptions>(
      object({
        visibilityTagKey: optional(str),
        internalValue: optional(str),
        scopeTagKeys: optional(arrayOf(str)),
      }),
    ),
    // Deliberately NO `reexport-edges` requirement. A barrel re-exporting its own internals
    // is already legal here because importer and target share a scope — the rule never
    // needs to know the edge was a re-export. Declaring a capability a rule does not read
    // would turn it OFF on hosts that work perfectly well for it.
  },
  visits: {
    edges: {
      filter: (o) => ({
        toTag: { [o.visibilityTagKey ?? "visibility"]: o.internalValue ?? "internal" },
      }),
      visit(e, ctx) {
        const { scopeTagKeys = ["layer", "slice"] } = ctx.options;
        const sameScope = scopeTagKeys.every(
          (key) => ctx.graph.tagOf(e.from, key) === ctx.graph.tagOf(e.to, key),
        );
        if (sameScope) return;
        const visibilityTagKey = ctx.options.visibilityTagKey ?? "visibility";
        const internalValue = ctx.options.internalValue ?? "internal";
        ctx.report({
          edge: e,
          messageId: "internalFromOutside",
          data: { from: e.from, to: e.to, visibilityTagKey, internalValue },
          explanation: `"${e.to}" is ${visibilityTagKey}:"${internalValue}"; use the owning module's public entry point (its index) instead.`,
        });
      },
    },
  },
});
