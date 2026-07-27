import { defineRule } from "@archwall/core";
import { docsUrlFor } from "./docs.js";
import { arrayOf, object, optional, ruleOptions, str } from "./schema.js";

export interface FeatureIsolationOptions {
  /** Default "slice". */
  sliceTagKey?: string;
  /** Isolation applies within a shared value of this tag. Default "layer". */
  scopeTagKey?: string;
  /** If set, only these layers are isolated; default: everywhere slices exist. */
  layers?: string[];
}

export const featureIsolation = defineRule<FeatureIsolationOptions>({
  meta: {
    name: "feature-isolation",
    description: "Forbids imports between different slices within the same layer.",
    defaultSeverity: "error",
    ...docsUrlFor("feature-isolation"),
    optionsSchema: ruleOptions<FeatureIsolationOptions>(
      object({
        sliceTagKey: optional(str),
        scopeTagKey: optional(str),
        layers: optional(arrayOf(str)),
      }),
    ),
  },
  check(ctx) {
    const { sliceTagKey = "slice", scopeTagKey = "layer", layers } = ctx.options;
    for (const e of ctx.graph.edges({ crossing: sliceTagKey })) {
      const scope = ctx.graph.tagOf(e.from, scopeTagKey);
      if (scope === undefined || scope !== ctx.graph.tagOf(e.to, scopeTagKey)) continue;
      if (layers !== undefined && !layers.includes(scope)) continue;
      const fromSlice = ctx.graph.tagOf(e.from, sliceTagKey)!;
      const toSlice = ctx.graph.tagOf(e.to, sliceTagKey)!;
      ctx.report({
        edge: e,
        message: `"${e.from}" (slice "${fromSlice}") may not import sibling slice "${toSlice}" ("${e.to}")`,
        explanation: `Slices within layer "${scope}" are isolated; share code via a lower layer or the slice's public API.`,
      });
    }
  },
});
