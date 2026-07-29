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
    recommended: true,
    ...docsUrlFor("feature-isolation"),
    messages: {
      siblingSlice:
        '"{from}" (slice "{fromSlice}") may not import sibling slice "{toSlice}" ("{to}")',
    },
    optionsSchema: ruleOptions<FeatureIsolationOptions>(
      object({
        sliceTagKey: optional(str),
        scopeTagKey: optional(str),
        layers: optional(arrayOf(str)),
      }),
    ),
  },
  visits: {
    edges: {
      filter: (o) => ({ crossing: o.sliceTagKey ?? "slice" }),
      visit(e, ctx) {
        const { sliceTagKey = "slice", scopeTagKey = "layer", layers } = ctx.options;
        const scope = ctx.graph.tagOf(e.from, scopeTagKey);
        if (scope === undefined || scope !== ctx.graph.tagOf(e.to, scopeTagKey)) return;
        if (layers !== undefined && !layers.includes(scope)) return;
        const fromSlice = ctx.graph.tagOf(e.from, sliceTagKey)!;
        const toSlice = ctx.graph.tagOf(e.to, sliceTagKey)!;
        ctx.report({
          edge: e,
          messageId: "siblingSlice",
          data: {
            from: ctx.display(e.from),
            to: ctx.display(e.to),
            fromSlice,
            toSlice,
            layer: scope,
          },
          explanation: `Slices within layer "${scope}" are isolated; share code via a lower layer or the slice's public API.`,
        });
      },
    },
  },
});
