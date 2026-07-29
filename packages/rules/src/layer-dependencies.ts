import { defineRule } from "@archwall/core";
import { docsUrlFor } from "./docs.js";
import { arrayOf, object, optional, required, ruleOptions, str } from "./schema.js";

export interface LayerDependenciesOptions {
  /** Ordered highest→lowest; a module may import SAME or LOWER layers only. */
  layers: string[];
  /** Default "layer". */
  tagKey?: string;
}

export const layerDependencies = defineRule<LayerDependenciesOptions>({
  meta: {
    name: "layer-dependencies",
    description:
      "Enforces an ordering over layer tags: modules may only depend on same or lower layers.",
    defaultSeverity: "error",
    recommended: true,
    ...docsUrlFor("layer-dependencies"),
    messages: {
      higherLayer:
        '"{from}" (layer "{fromLayer}") may not import from higher layer "{toLayer}" ("{to}")',
    },
    optionsSchema: ruleOptions<LayerDependenciesOptions>(
      object({ layers: required(arrayOf(str)), tagKey: optional(str) }),
    ),
  },
  visits: {
    edges: {
      // Only edges that cross a layer boundary can violate an ordering over layers; the
      // engine narrows to them once and shares the result with every rule wanting the same.
      filter: (o) => ({ crossing: o.tagKey ?? "layer" }),
      visit(e, ctx) {
        const { layers, tagKey = "layer" } = ctx.options;
        const fromLayer = ctx.graph.tagOf(e.from, tagKey)!;
        const toLayer = ctx.graph.tagOf(e.to, tagKey)!;
        const fi = layers.indexOf(fromLayer);
        const ti = layers.indexOf(toLayer);
        if (fi === -1 || ti === -1 || ti >= fi) return;
        ctx.report({
          edge: e,
          messageId: "higherLayer",
          data: {
            from: ctx.display(e.from),
            to: ctx.display(e.to),
            fromLayer,
            toLayer,
          },
          explanation: `Configured layer order (highest first): ${layers.join(" → ")}. Modules may only import same or lower layers.`,
        });
      },
    },
  },
});
