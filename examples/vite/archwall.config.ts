import {
  defineClassifier,
  defineConfig,
  featureIsolation,
  layerDependencies,
  noCycles,
  publicApi,
} from "archwall";

/*
 * ArchWall has no built-in notion of "layers". It knows two things:
 *
 *   1. a module graph, produced by whatever is compiling your code, and
 *   2. string tags attached to each module by a *classifier* you write.
 *
 * Rules are queries over those tags. So an architecture contract is just
 * "a classifier + the rules that read its tags" — which is all this file is.
 *
 * In practice you would write `presets: [fsd()]` — @archwall/presets ships this exact
 * contract, and two others. This example writes it out by hand so nothing is hidden;
 * see docs/presets/building-blocks.md for the declarative `pathClassifier` the presets
 * use instead of a hand-written classify function.
 */

/** Highest → lowest. A module may import its own layer and anything below it. */
const LAYERS = ["app", "pages", "features", "entities", "shared"];

/** Layers whose direct children are *slices*: self-contained units with a public API. */
const SLICED_LAYERS = ["pages", "features", "entities"];

const INDEX_FILE = /^index\.[cm]?[jt]sx?$/;

/**
 * Derives tags from a module's path, relative to `sourceRoot` (below: `src/`).
 *
 *   features/create-task/index.ts
 *     → { layer: "features", slice: "create-task", visibility: "public" }
 *   features/create-task/model/create-task.ts
 *     → { layer: "features", slice: "create-task", segment: "model", visibility: "internal" }
 *   shared/ui/Button.ts
 *     → { layer: "shared" }                  // `shared` has no slices
 *
 * Returning `null` leaves a module untagged, and every rule below ignores untagged
 * modules — which is how `node_modules` and stray files stay out of the way.
 */
const architecture = defineClassifier({
  name: "task-board",
  classify(module, ctx) {
    if (module.kind !== "source" || !module.file) return null;

    // `ctx.relative` is the source-root-relative path, or null when the file lies outside
    // the tree this config describes. Every path-based classifier wants exactly this.
    const rel = ctx.relative(module.file);
    if (rel === null) return null;

    const [layer, slice, ...rest] = rel.split("/");
    if (layer === undefined || !LAYERS.includes(layer)) return null;

    // Unsliced layer (`app`, `shared`), or a file sitting directly in a sliced layer.
    if (!SLICED_LAYERS.includes(layer) || slice === undefined || rest.length === 0) {
      return { layer };
    }

    const tags: Record<string, string> = {
      layer,
      slice,
      // A slice's index file is its public API; everything else is internal to it.
      visibility: rest.length === 1 && INDEX_FILE.test(rest[0]!) ? "public" : "internal",
    };
    if (rest.length > 1) tags["segment"] = rest[0]!;
    return tags;
  },
});

export default defineConfig({
  /** Relative to this file. Becomes the absolute `ctx.sourceRoot` the classifier sees. */
  sourceRoot: "src",

  classifiers: [architecture],

  rules: [
    /** `shared` may not import `entities`, `entities` may not import `features`, … */
    layerDependencies({ layers: LAYERS }),

    /** Sibling slices are isolated: one feature may never import another feature. */
    featureIsolation({ layers: SLICED_LAYERS }),

    /**
     * Reads `visibility` — a slice's internals are off-limits from outside the slice,
     * so cross-slice imports have to go through the slice's index.
     *
     * `@archwall/rules` also ships `noDeepImports`, which enforces the same thing by
     * matching the specifier you literally typed rather than the resolved graph. It is
     * not enabled here because it needs the raw specifier, and Vite 8 expands aliases
     * before plugins observe them — see "What this example does not show" in README.md.
     */
    publicApi(),

    noCycles(),
  ],

  /** Downgrade any rule by name, e.g. `overrides: { "no-cycles": "warn" }`. */
  overrides: {},

  reporters: ["console"],

  /** Build fails on an error-severity violation. Dev only ever warns. */
  failOn: "error",
});
