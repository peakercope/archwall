import type { Classifier, ModuleKind, Preset } from "@archwall/core";
import { definePreset, pathClassifier } from "@archwall/core";
import {
  featureIsolation,
  forbiddenDependencies,
  layerDependencies,
  noCycles,
  publicApi,
  requireTag,
} from "@archwall/rules";
import { type LayerSpec, layerNames, layerPatterns, presetDocsUrlFor, within } from "./shared.js";

export interface LayeredOptions {
  /** Directory the layers live in, relative to the config root. Default ".". */
  root?: string;
  /**
   * Ordered highest→lowest: a layer may import its own layer or a lower one, never a
   * higher one. Either directory names (`["presentation", "application", "domain"]`) or
   * a map from layer name to the glob(s) holding it (`{ domain: "core/domain" }`).
   */
  layers: LayerSpec;
  /**
   * Layers that may not reach outside the codebase at all — the constraint that
   * actually distinguishes Clean/Onion/Hexagonal from plain layering. Covers npm
   * dependencies and runtime builtins alike, because `node:crypto` in a domain layer is
   * the same nondeterminism Clean asks you to push to the edges.
   *
   * Sibling *workspace* packages are never a purity violation: they are your code, and
   * an import into one is a boundary question (`friend-modules`, `forbidden-dependencies`)
   * rather than a purity question.
   */
  pure?: string[];
  /**
   * Let `pure` layers import runtime builtins (`node:*`) while still forbidding npm
   * dependencies. Useful when your domain legitimately uses `node:assert` or
   * `node:util`. Default false.
   */
  allowBuiltins?: boolean;
  /** Packages a `pure` layer may still import. Glob-lite, so "@company/*" works. */
  allowExternals?: string[];
  /** Layers whose immediate subdirectories may not import each other (hexagonal adapters). */
  isolate?: string[];
  /** Enforce that a layer's subdirectories are reachable only through their index.*. */
  publicApi?: boolean;
  /** Report files under `root` that belong to no layer. Default false. */
  strict?: boolean;
}

export function layeredClassifier(opts: LayeredOptions): Classifier {
  return pathClassifier({
    name: "layered",
    root: opts.root ?? ".",
    patterns: layerPatterns(opts.layers, opts.publicApi ? "index.*" : false),
  });
}

/**
 * Ordered layers with one-way dependencies, plus the purity constraint that makes it
 * Clean/Onion/Hexagonal rather than generic layering.
 */
export const layered = definePreset((opts: LayeredOptions): Preset => {
  const { pure, allowExternals, allowBuiltins = false, isolate, strict = false, root = "." } = opts;
  const layers = layerNames(opts.layers);
  const impureKinds: ModuleKind[] = allowBuiltins ? ["package"] : ["package", "builtin"];

  return {
    name: "layered",
    meta: {
      description:
        "Ordered layers with one-way dependencies, plus the purity constraint that makes it Clean/Onion/Hexagonal.",
      ...presetDocsUrlFor("layered"),
    },
    classifiers: [layeredClassifier(opts)],
    rules: [
      layerDependencies({ layers }),
      noCycles(),
      ...(pure && pure.length > 0
        ? pure.map((layer) =>
            forbiddenDependencies(
              {
                forbid: [
                  {
                    from: { tag: { layer } },
                    to: { moduleKind: impureKinds },
                    ...(allowExternals && allowExternals.length > 0
                      ? { except: { packageName: allowExternals } }
                      : {}),
                    message: allowBuiltins
                      ? `"${layer}" must not depend on third-party packages — it is the part of the system that owns your rules, not your libraries`
                      : `"${layer}" must not depend on anything outside the codebase — it is the part of the system that owns your rules, not your libraries or your runtime`,
                  },
                ],
              },
              // One instance per layer so each is separately overridable by id.
              { id: `layered/purity-${layer}` },
            ),
          )
        : []),
      ...(isolate && isolate.length > 0 ? [featureIsolation({ layers: isolate })] : []),
      ...(opts.publicApi ? [publicApi({ scopeTagKeys: ["layer", "slice"] })] : []),
      ...(strict ? [requireTag({ tag: "layer", within: [within(root)] })] : []),
    ],
  };
});
