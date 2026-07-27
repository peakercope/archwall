import type { PathPattern } from "@archwall/core";

/**
 * Layers are either an ordered list of directory names, or a map from layer name to
 * the glob(s) that hold it — the map form is what real trees need
 * (`core/domain`, `core/application`, `infrastructure`).
 *
 * Order always means highest → lowest: a layer may import its own layer or a lower
 * one, never a higher one. With the map form, key order is the layer order.
 */
export type LayerSpec = string[] | Record<string, string | string[]>;

export function layerNames(spec: LayerSpec): string[] {
  return Array.isArray(spec) ? [...spec] : Object.keys(spec);
}

/**
 * Compiles a layer spec into pathClassifier patterns. A layer whose directory is a
 * plain name also captures a `slice` (its immediate subdirectory), so sibling
 * isolation inside a layer works without extra configuration.
 */
export function layerPatterns(spec: LayerSpec, publicApi: string | false): PathPattern[] {
  const patterns: PathPattern[] = [];

  if (Array.isArray(spec)) {
    if (publicApi !== false) {
      patterns.push({
        pattern: `:layer/:slice/${publicApi}`,
        tags: { visibility: "public" },
        only: { layer: spec },
      });
    }
    patterns.push({ pattern: ":layer/:slice/**", only: { layer: spec } });
    patterns.push({ pattern: ":layer/**", only: { layer: spec } });
    return patterns;
  }

  for (const [layer, globs] of Object.entries(spec)) {
    for (const glob of Array.isArray(globs) ? globs : [globs]) {
      const base = glob.replace(/\/?\*+$/, "");
      if (publicApi !== false) {
        patterns.push({
          pattern: `${base}/:slice/${publicApi}`,
          tags: { layer, visibility: "public" },
        });
      }
      patterns.push({ pattern: `${base}/:slice/**`, tags: { layer } });
      patterns.push({ pattern: `${base}/**`, tags: { layer } });
    }
  }
  return patterns;
}

/**
 * A preset's root as a `require-tag` glob. `require-tag` matches paths relative to the
 * CONFIG root, while a preset's root is relative to that too — so strict mode must
 * scope itself to the preset's own subtree, not the whole project.
 */
export function within(root: string): string {
  const trimmed = root.replace(/\/+$/, "");
  return trimmed === "." || trimmed === "" ? "**" : `${trimmed}/**`;
}
