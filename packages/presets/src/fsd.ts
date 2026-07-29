import type { Classifier, PathPattern, Preset } from "@archwall/core";
import { definePreset, pathClassifier } from "@archwall/core";
import {
  featureIsolation,
  friendModules,
  layerDependencies,
  noCycles,
  publicApi,
  requireTag,
} from "@archwall/rules";
import { presetDocsUrlFor, within } from "./shared.js";

export const FSD_LAYERS = ["app", "pages", "widgets", "features", "entities", "shared"] as const;

/** Layers that have slices by default: all except "app" and "shared". */
export const DEFAULT_SLICED_LAYERS: ReadonlySet<string> = new Set([
  "pages",
  "widgets",
  "features",
  "entities",
]);

export interface FsdOptions {
  /** Path of the FSD root RELATIVE to the config root. Default ".". */
  src?: string;
  /** Ordered highest→lowest. Default [...FSD_LAYERS]. */
  layers?: string[];
  /** Layers that have slices. Default: all configured layers except "app" and "shared". */
  slicedLayers?: string[];
  /**
   * FSD cross-imports (`@x`): slice → the sibling slices it may reach. Providing this
   * replaces blanket sibling isolation with an explicit allow-list, so a slice may
   * import only the siblings named here.
   */
  crossImports?: Record<string, string[]>;
  /** Report files under `src` that belong to no layer. Default false. */
  strict?: boolean;
}

export function fsdClassifier(opts: FsdOptions = {}): Classifier {
  const { src = ".", layers = [...FSD_LAYERS], slicedLayers } = opts;
  const sliced = slicedLayers ?? layers.filter((l) => DEFAULT_SLICED_LAYERS.has(l));

  const patterns: PathPattern[] = [
    // <layer>/<slice>/index.* — the slice's public API.
    {
      pattern: ":layer/:slice/index.*",
      tags: { visibility: "public" },
      only: { layer: sliced },
    },
    // <layer>/<slice>/@x/<neighbour>.* — FSD's official cross-import public API.
    {
      pattern: ":layer/:slice/@x/**",
      tags: { visibility: "public" },
      only: { layer: sliced },
    },
    // The `/*` before each trailing `**` says the captured segment is a DIRECTORY. Without
    // it, `**` matching zero segments would let `widgets/header/ui.ts` capture `ui.ts` as a
    // segment, and `app/main.ts` capture `main.ts` as a slice.
    {
      pattern: ":layer/:slice/:segment/*/**",
      tags: { visibility: "internal" },
      only: { layer: sliced },
    },
    {
      pattern: ":layer/:slice/*/**",
      tags: { visibility: "internal" },
      only: { layer: sliced },
    },
    // Unsliced layers (app, shared) and anything shallower.
    { pattern: ":layer/*/**", only: { layer: layers } },
  ];

  return pathClassifier({ name: "fsd", root: src, patterns });
}

/**
 * Feature-Sliced Design: layers are ordered, slices within a layer are isolated, and a
 * slice is reachable only through its public API.
 */
export const fsd = definePreset((opts: FsdOptions = {}): Preset => {
  const layers = opts.layers ?? [...FSD_LAYERS];
  const sliced = opts.slicedLayers ?? layers.filter((l) => DEFAULT_SLICED_LAYERS.has(l));
  const { crossImports, strict = false, src = "." } = opts;

  return {
    name: "fsd",
    meta: {
      description:
        "Feature-Sliced Design: ordered layers, isolated slices, public-API-only access.",
      ...presetDocsUrlFor("fsd"),
    },
    classifiers: [fsdClassifier(opts)],
    rules: [
      layerDependencies({ layers }),
      // Isolation and friends both police sibling imports; running both would report
      // every violation twice, so cross-imports REPLACES isolation rather than joining it.
      crossImports
        ? friendModules({ tagKey: "slice", friends: crossImports })
        : featureIsolation({ layers: sliced }),
      publicApi(),
      noCycles(),
      ...(strict ? [requireTag({ tag: "layer", within: [within(src)] })] : []),
    ],
  };
});
