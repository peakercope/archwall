import * as path from "node:path";
import type { EdgeKind, GraphBuilder, ModuleKindResolver } from "@archwall/integration-kit";
import type { MetafileLike } from "./esbuild-types.js";

/**
 * Maps a metafile import kind to an IR edge kind.
 *
 * Only `dynamic-import` is distinguished, and that is not a shortcut: the metafile records
 * `export … from` as a plain `import-statement`, so `reexport` is genuinely unavailable
 * here rather than merely unimplemented — which is why this adapter does not claim
 * `reexport-edges`.
 *
 * Everything else — `require-call`, `require-resolve`, `import-rule`, `url-token`,
 * `composes-from` — is a static dependency of the importing module, and an unrecognised
 * future kind is too. `static` is the safe answer for an unknown: it is the only kind
 * `no-cycles` treats as binding, so guessing `dynamic` would silently excuse a real cycle.
 */
export function edgeKindOf(kind: string): EdgeKind {
  return kind === "dynamic-import" ? "dynamic" : "static";
}

/**
 * A metafile key that is not a path on disk.
 *
 * Two forms exist, both verified against esbuild 0.28:
 * - `<data:text/javascript,…>` — a data-URL import, angle-bracket wrapped.
 * - `my-ns:thing` — a module a plugin claimed into its own namespace.
 *
 * The scheme must be **two or more characters** so a Windows drive letter (`C:/src/a.ts`,
 * which esbuild emits when a file sits on a different drive than `absWorkingDir`) is not
 * mistaken for a namespace.
 */
const SYNTHETIC_NAMESPACE = /^[A-Za-z][A-Za-z0-9.+-]+:/;

export interface MetafileModuleId {
  id: string;
  /** Absolute path, or null when the key denotes no file on disk. */
  file: string | null;
  /** Host-synthesized: a plugin namespace or a data URL, not the user's code. */
  virtual: boolean;
}

/**
 * Resolves a metafile key to a module id.
 *
 * Keys are relative to `absWorkingDir` with forward slashes, and may climb out of it
 * (`../../node_modules/react/index.js` for a bundled dependency), so they must be resolved
 * rather than joined.
 *
 * Getting `file` wrong here is not cosmetic: `createModuleKindResolver` walks upward from a
 * file looking for the nearest `package.json`, so handing it `my-ns:thing` as though it were
 * a path would find some unrelated manifest above the working directory and label a
 * plugin's virtual module a workspace sibling.
 */
export function moduleIdOf(key: string, root: string): MetafileModuleId {
  if (key.startsWith("<") || SYNTHETIC_NAMESPACE.test(key)) {
    return { id: key, file: null, virtual: true };
  }
  const file = path.resolve(root, key);
  return { id: file, file, virtual: false };
}

/**
 * Walks an esbuild metafile into the IR.
 *
 * `metafile.inputs` is the whole extraction surface: esbuild exposes no module-graph hook,
 * so the graph is read once, after the build, from what it recorded.
 *
 * External targets are registered EXPLICITLY rather than left to `GraphBuilder.build()`'s
 * auto-materialization. They never appear as `inputs` keys, and passing the specifier
 * through the shared resolver is what makes `node:path` come back `builtin` instead of
 * `package` — the distinction a purity rule depends on.
 */
export function addMetafileModules(
  builder: GraphBuilder,
  metafile: MetafileLike,
  kinds: ModuleKindResolver,
  root: string,
): void {
  for (const [key, input] of Object.entries(metafile.inputs)) {
    const from = moduleIdOf(key, root);
    builder.addModule({
      id: from.id,
      file: from.file,
      // A namespace or data-URL id is host syntax, and the shared resolver only knows
      // Rollup's `\0` convention. Naming the kind here is the same fact-reporting the
      // other adapters do — `virtual` is what a synthesized module with no file IS.
      ...(from.virtual
        ? { kind: "virtual" as const }
        : kinds.infer({ id: from.id, file: from.file })),
    });

    for (const imp of input.imports) {
      let to: string;
      if (imp.external === true) {
        // `path` is the bare specifier the author wrote; there is no `original` because
        // nothing was resolved away from it.
        to = imp.path;
        builder.addModule({
          id: to,
          file: null,
          specifier: to,
          ...kinds.infer({ id: to, file: null, specifier: to, isExternal: true }),
        });
      } else {
        const target = moduleIdOf(imp.path, root);
        to = target.id;
        // Registered when its own `inputs` entry is reached; the edge only needs the id.
      }
      builder.addEdge({
        from: from.id,
        to,
        rawSpecifier: imp.original ?? imp.path,
        resolvedPath: to,
        kind: edgeKindOf(imp.kind),
      });
    }
  }
}
