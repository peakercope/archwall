import * as fs from "node:fs";
import * as path from "node:path";
import type { ModuleKind } from "@archwall/core";
import { packageNameFromPath } from "./module-path.js";
import { barePackageName, isBuiltinSpecifier } from "./specifiers.js";

/**
 * The single definition of what a module *is*.
 *
 * This decision used to be made independently three times — `vite/src/index.ts`,
 * `rspack/src/extract.ts`, and inline in `cli/src/scan.ts` — with only
 * `isBuiltinSpecifier` and `packageNameFromPath` shared. The *facts* differ per host and
 * always will; the *policy* must not, and three copies of a policy is how they came to
 * disagree about `workspace`: only the CLI ever emitted that kind, so a rule written
 * against it fired under the CLI and silently enforced nothing under all three bundlers.
 *
 * Adapters now supply only what their host actually knows, and this decides.
 */

const NODE_MODULES = /[\\/]node_modules[\\/]/;

/** Everything a host can observe about a module, all of it optional but `id`. */
export interface ModuleFacts {
  /** The host's module id. */
  id: string;
  /** Absolute path, query stripped; null when there is no file on disk. */
  file: string | null;
  /**
   * The host's own externality verdict, where it has one (Rollup's `ModuleInfo.isExternal`).
   * Rolldown dropped it, so it is genuinely absent under Vite 8+ rather than always false.
   */
  isExternal?: boolean | undefined;
  /**
   * The bare specifier behind a synthetic external module, where the host encodes one
   * (webpack/Rspack render externals as `external "react"`). Lets a runtime builtin be
   * told from a real dependency without a file to inspect.
   */
  specifier?: string | undefined;
  /** The host tried to resolve this specifier and failed. */
  unresolved?: boolean | undefined;
}

export interface InferredModule {
  kind: ModuleKind;
  packageName?: string;
  workspace?: string;
}

export interface ModuleKindResolver {
  infer(facts: ModuleFacts): InferredModule;
}

interface PackageOwner {
  /** Directory containing the package.json. */
  dir: string;
  name: string | undefined;
}

/**
 * Nearest enclosing package.json. Best-effort by design: an unreadable or unnamed manifest
 * leaves the owner unnamed rather than failing a build, and a tree with no manifest at all
 * (the common single-package case) simply has no owners to compare.
 */
function findOwner(
  startDir: string,
  cache: Map<string, PackageOwner | undefined>,
): PackageOwner | undefined {
  const chain: string[] = [];
  let dir = startDir;
  for (;;) {
    const hit = cache.get(dir);
    if (hit !== undefined || cache.has(dir)) {
      for (const d of chain) cache.set(d, hit);
      return hit;
    }
    chain.push(dir);
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest)) {
      let name: string | undefined;
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
        const candidate = (parsed as { name?: unknown }).name;
        name = typeof candidate === "string" ? candidate : undefined;
      } catch {
        name = undefined;
      }
      const owner: PackageOwner = {
        dir,
        ...(name !== undefined ? { name } : { name: undefined }),
      };
      for (const d of chain) cache.set(d, owner);
      return owner;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      for (const d of chain) cache.set(d, undefined);
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Binds the policy to one project. `sourceRoot` is what makes `source` vs `workspace`
 * answerable at all: a first-party file is `workspace` precisely when a *different*
 * package owns it, and "different" is only meaningful relative to the package being
 * analysed.
 */
export function createModuleKindResolver(opts: { sourceRoot: string }): ModuleKindResolver {
  const cache = new Map<string, PackageOwner | undefined>();
  const projectOwner = findOwner(path.resolve(opts.sourceRoot), cache);

  return {
    infer(facts: ModuleFacts): InferredModule {
      // Toolchain-generated ids never correspond to anything on disk, and every host
      // marks them the same way.
      if (facts.id.startsWith("\0")) return { kind: "virtual" };

      // BEFORE the file branch. Bundlers hand us `file = id` for any id that is not
      // `\0`-prefixed, so `node:path` arrives looking like a file path — and since it is
      // not under node_modules, the owner walk below would find some unrelated
      // package.json above the working directory and call a Node builtin a `workspace`
      // sibling. A builtin is a builtin whatever the host claims its file is.
      const idSpecifier = facts.specifier ?? facts.id;
      if (isBuiltinSpecifier(idSpecifier)) return { kind: "builtin" };

      // Same trap, one step further out: an id that is not a builtin and not an absolute
      // path is a bare specifier the host left unresolved, not a file.
      const looksLikeFile =
        facts.file !== null && (path.isAbsolute(facts.file) || /^[A-Za-z]:[\\/]/.test(facts.file));

      if (looksLikeFile && facts.file !== null) {
        const file = facts.file.replaceAll("\\", "/");
        if (NODE_MODULES.test(facts.file)) {
          const packageName = packageNameFromPath(file);
          return {
            kind: "package",
            ...(packageName !== undefined ? { packageName } : {}),
          };
        }
        const owner = findOwner(path.dirname(path.resolve(file)), cache);
        // A different package in the same tree. Checked BEFORE the host's `isExternal`,
        // because a library build routinely externalizes its workspace siblings and
        // "sibling package" is the more specific — and more useful — answer of the two.
        if (owner !== undefined && projectOwner !== undefined && owner.dir !== projectOwner.dir) {
          return {
            kind: "workspace",
            ...(owner.name !== undefined ? { workspace: owner.name } : {}),
          };
        }
        // The host says this is not part of the build and nothing above identified it as
        // a sibling, so take its word for it.
        if (facts.isExternal === true) return { kind: "package" };
        // First-party source. Files outside `sourceRoot` stay `source` here and are
        // re-kinded `excluded` by the engine's project boundary — that is a boundary
        // decision, not a kind decision.
        return { kind: "source" };
      }

      // Not a file: the specifier is the only evidence left. (Builtins were already
      // settled above, before the file branch.)
      const specifier = idSpecifier;
      const packageName = barePackageName(specifier);
      if (facts.unresolved === true) {
        // A bare specifier that did not resolve is still an intended package dependency;
        // a relative one is a genuine dangling import.
        return packageName !== undefined
          ? { kind: "package", packageName }
          : { kind: "unresolved" };
      }
      if (packageName !== undefined) return { kind: "package", packageName };

      // A bundled dependency IS a filesystem path, so "looks like a path" alone would
      // classify node_modules code as first-party — which is why it is consulted last,
      // after the node_modules check above has already run.
      const looksLikePath = specifier.startsWith("/") || /^[A-Za-z]:[\\/]/.test(specifier);
      if (facts.isExternal ?? !looksLikePath) return { kind: "package" };
      return { kind: "virtual" };
    },
  };
}
