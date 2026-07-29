import type { Classifier, PathPattern, Preset } from "@archwall/core";
import { definePreset, pathClassifier } from "@archwall/core";
import { friendModules, noCycles, publicApi, requireTag } from "@archwall/rules";
import { presetDocsUrlFor, within } from "./shared.js";

export interface ModulesOptions {
  /**
   * Directory holding the modules, relative to the config root. Each immediate
   * subdirectory is one module. Default "." (top-level folders are the modules).
   */
  root?: string;
  /** Modules every other module may import without declaring it, e.g. ["shared"]. */
  shared?: string[];
  /**
   * The dependency matrix: module → the modules it may import. Omit for total
   * isolation (no module may import any other). This is a bounded-context map.
   */
  depends?: Record<string, string[]>;
  /** Modules are reachable only through their index.*. Default true. */
  publicApi?: boolean;
  /** Report files under `root` that belong to no module. Default false. */
  strict?: boolean;
}

export function modulesClassifier(opts: ModulesOptions = {}): Classifier {
  const { root = ".", publicApi: enforcePublicApi = true } = opts;
  const patterns: PathPattern[] = [];
  if (enforcePublicApi) {
    patterns.push({
      pattern: ":module/index.*",
      tags: { visibility: "public" },
    });
  }
  // `/*` before the trailing `**`: `**` matches zero segments, so `:module/**` alone would
  // match a loose `stray.ts` at the root and capture the filename as a module name. A module
  // is a DIRECTORY, and a file that is in none of them must stay untagged so `strict` mode
  // can report it.
  patterns.push({ pattern: ":module/*/**", tags: { visibility: "internal" } });
  return pathClassifier({ name: "modules", root, patterns });
}

/**
 * Independent modules that talk only through public APIs, with an explicit map of who
 * may depend on whom. Modular monolith, package-by-feature, vertical slices, and
 * bounded contexts are all this shape.
 */
export const modules = definePreset((opts: ModulesOptions = {}): Preset => {
  const {
    shared = [],
    depends,
    publicApi: enforcePublicApi = true,
    strict = false,
    root = ".",
  } = opts;

  return {
    name: "modules",
    meta: {
      description:
        "Independent modules: an explicit dependency policy between top-level modules, each reached through its public API.",
      ...presetDocsUrlFor("modules"),
    },
    classifiers: [modulesClassifier(opts)],
    rules: [
      // One rule covers both modes: an empty matrix is already total isolation, and
      // `shared` needs an exemption that blanket isolation cannot express.
      friendModules({
        tagKey: "module",
        friends: depends ?? {},
        alwaysAllow: shared,
      }),
      ...(enforcePublicApi ? [publicApi({ scopeTagKeys: ["module"] })] : []),
      noCycles(),
      ...(strict ? [requireTag({ tag: "module", within: [within(root)] })] : []),
    ],
  };
});
