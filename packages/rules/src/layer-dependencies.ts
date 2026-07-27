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
    ...docsUrlFor("layer-dependencies"),
    optionsSchema: ruleOptions<LayerDependenciesOptions>(
      object({ layers: required(arrayOf(str)), tagKey: optional(str) }),
    ),
  },
  check(ctx) {
    const { layers, tagKey = "layer" } = ctx.options;
    for (const e of ctx.graph.edges({ crossing: tagKey })) {
      const fromLayer = ctx.graph.tagOf(e.from, tagKey)!;
      const toLayer = ctx.graph.tagOf(e.to, tagKey)!;
      const fi = layers.indexOf(fromLayer);
      const ti = layers.indexOf(toLayer);
      if (fi === -1 || ti === -1 || ti >= fi) continue;
      ctx.report({
        edge: e,
        message: `"${e.from}" (layer "${fromLayer}") may not import from higher layer "${toLayer}" ("${e.to}")`,
        explanation: `Configured layer order (highest first): ${layers.join(" → ")}. Modules may only import same or lower layers.`,
      });
    }
  },
});
