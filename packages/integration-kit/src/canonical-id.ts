import type { ModuleId, ModuleKind } from "@archwall/core";
import { toRelative } from "@archwall/core/internal";
import { packageNameFromPath } from "./module-path.js";
import { barePackageName, isBuiltinSpecifier } from "./specifiers.js";

/**
 * Turning host facts into the IR's own module identity.
 *
 * The *facts* differ per host and always will; the *identity* must not — the same module under
 * Vite, esbuild, and the CLI has to be the same string, or a violation fingerprint is
 * machine-specific and a baseline file is impossible.
 *
 * This is the identity counterpart of `createModuleKindResolver`, and it runs in the same place
 * for the same reason: one policy, applied at the single choke point every producer already
 * passes through.
 *
 * See docs/adr/0012-canonical-module-identity.md.
 */

/** Everything identity is derived from. All of it already known by the time a module is added. */
export interface CanonicalIdInput {
  /** The host's own module id. */
  id: string;
  file: string | null;
  kind: ModuleKind;
  /** npm package name, where the kind resolver worked one out. */
  packageName?: string | undefined;
  /**
   * The bare specifier behind a module the host did not resolve to a file — recovered by the
   * adapter from whatever its host encodes (`external "react"`, a metafile external path, the
   * lexed specifier). The only evidence available for a builtin or an unresolved import.
   */
  specifier?: string | undefined;
}

export interface CanonicalIdOptions {
  /** Absolute repository root; the base `file:` ids are relative to. */
  repoRoot: string;
  /** Names the producer inside `virtual:` ids, which are host-specific by nature. */
  hostName: string;
}

/**
 * `fs` and `node:fs` are one module. Hosts disagree about which spelling survives — the CLI
 * records what the author wrote, webpack re-renders it — so both collapse onto the prefixed form.
 */
function normalizeBuiltin(specifier: string): string {
  return /^(node|bun|deno):/.test(specifier) ? specifier : `node:${specifier}`;
}

/** Forward slashes, and without the `\0` every Rollup-shaped host prefixes virtual ids with. */
function cleanOpaque(id: string): string {
  return id.replace(/^\0/, "").replaceAll("\\", "/");
}

export function canonicalModuleId(input: CanonicalIdInput, opts: CanonicalIdOptions): ModuleId {
  const specifier = input.specifier ?? input.id;

  switch (input.kind) {
    case "virtual":
      return `virtual:${opts.hostName}:${cleanOpaque(specifier)}`;

    case "builtin":
      return `builtin:${normalizeBuiltin(cleanOpaque(specifier))}`;

    case "package": {
      // A package is ONE node, deliberately: an esbuild external is never resolved, so its
      // subpath is unknowable, and any scheme keeping file granularity inside a dependency
      // would diverge across hosts. `packageName` still carries the name for rules.
      const name =
        input.packageName ??
        (input.file !== null ? packageNameFromPath(input.file) : undefined) ??
        barePackageName(cleanOpaque(specifier));
      return name !== undefined ? `pkg:${name}` : `unresolved:${cleanOpaque(specifier)}`;
    }

    case "unresolved":
      return `unresolved:${cleanOpaque(specifier)}`;

    default: {
      // source | workspace | excluded — first-party code, identified by where it sits.
      if (input.file === null) return `unresolved:${cleanOpaque(specifier)}`;
      return `file:${toRelative(opts.repoRoot, input.file)}`;
    }
  }
}

/** Whether a kind's canonical id denotes a file on disk. Everything else carries `file: null`. */
export function identifiesAFile(kind: ModuleKind): boolean {
  return kind === "source" || kind === "workspace" || kind === "excluded";
}

/** Exported for the adapters that must recover a builtin's canonical spelling themselves. */
export { isBuiltinSpecifier };
