import { defineRule } from "@archwall/core";
import { docsUrlFor } from "./docs.js";
import { arrayOf, object, optional, ruleOptions, str } from "./schema.js";

export interface PublicApiOptions {
  /** Default "visibility". */
  visibilityTagKey?: string;
  /** Default "internal". */
  internalValue?: string;
  /**
   * An import INTO an internal module is legal only when importer and target agree
   * on ALL of these tags (undefined === undefined counts as agreement). Default ["layer", "slice"].
   */
  scopeTagKeys?: string[];
}

export const publicApi = defineRule<PublicApiOptions>({
  meta: {
    name: "public-api",
    description:
      "Enforces module entry points: internal modules may only be imported from within their own scope.",
    defaultSeverity: "error",
    ...docsUrlFor("public-api"),
    optionsSchema: ruleOptions<PublicApiOptions>(
      object({
        visibilityTagKey: optional(str),
        internalValue: optional(str),
        scopeTagKeys: optional(arrayOf(str)),
      }),
    ),
    // Deliberately NO `reexport-edges` requirement. A barrel re-exporting its own
    // internals (`index.ts` doing `export * from "./model/store"`) is already legal here
    // because importer and target share a scope — the rule never needs to know the edge
    // was a re-export. Declaring a capability a rule does not actually read would turn the
    // rule OFF on hosts that work perfectly well for it, which is a worse failure than the
    // one capabilities exist to prevent.
  },
  check(ctx) {
    const {
      visibilityTagKey = "visibility",
      internalValue = "internal",
      scopeTagKeys = ["layer", "slice"],
    } = ctx.options;
    for (const e of ctx.graph.edges({
      toTag: { [visibilityTagKey]: internalValue },
    })) {
      const sameScope = scopeTagKeys.every(
        (key) => ctx.graph.tagOf(e.from, key) === ctx.graph.tagOf(e.to, key),
      );
      if (sameScope) continue;
      ctx.report({
        edge: e,
        message: `"${e.from}" may not import internal module "${e.to}" from outside its scope`,
        explanation: `"${e.to}" is ${visibilityTagKey}:"${internalValue}"; use the owning module's public entry point (its index) instead.`,
      });
    }
  },
});
