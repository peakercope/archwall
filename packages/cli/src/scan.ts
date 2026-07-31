import * as fs from "node:fs";
import * as path from "node:path";
import type { EdgeKind, HostInfo, ProjectGraph, ResolvedConfig } from "@archwall/core";
import { sourceRelative } from "@archwall/core/internal";
import {
  createModuleKindResolver,
  GraphBuilder,
  isBuiltinSpecifier,
} from "@archwall/integration-kit";
import { init, parse } from "es-module-lexer";
import { ResolverFactory } from "oxc-resolver";
import picomatch from "picomatch";
import { glob } from "tinyglobby";

export function cliHost(): HostInfo {
  return {
    name: "cli",
    version: "0.0.0",
    // The scanner lexes source directly, so the specifier it records IS what the author
    // wrote — the strongest position of any producer.
    capabilities: new Set([
      "complete-graph",
      "dynamic-imports",
      "import-locations",
      "reexport-edges",
      "raw-specifiers",
    ]),
  };
}

export function offsetToLineCol(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart };
}

function findTsconfig(root: string): string | null {
  let dir = root;
  for (;;) {
    const candidate = path.join(dir, "tsconfig.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const TYPE_ONLY = /^(import|export)\s+type[\s{]/;

/**
 * What this scanner can lex. A bundler adapter has no equivalent — its host already
 * decided what a module is — which is exactly why this list must not live in the shared
 * config as `include`.
 */
const SCANNABLE = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];

/**
 * The CLI's own graph producer: walk include globs, lex imports, resolve like the
 * toolchain would (tsconfig paths included). Type-only statements are skipped —
 * they are erased before any bundler graph exists (documented v1 non-goal).
 */
export async function buildGraphFromFilesystem(
  config: ResolvedConfig,
  host: HostInfo,
): Promise<ProjectGraph> {
  await init;
  // Two different questions, deliberately answered separately:
  //   SCANNABLE — which files can this scanner open and lex at all. Only the CLI has to
  //     ask it, because only the CLI enumerates a directory tree; a bundler adapter is
  //     handed a graph whose membership the compiler already decided.
  //   include/exclude — which modules are part of the project. The ENGINE applies these
  //     to the graph, so every host agrees; re-applying them here is purely an
  //     optimization that avoids reading files the engine would discard.
  const matchesInclude = picomatch(config.include, { dot: true });
  const found = await glob(SCANNABLE, {
    cwd: config.sourceRoot,
    ignore: config.exclude,
    absolute: true,
  });
  const files = found
    .filter((f) => {
      const rel = sourceRelative(config.sourceRoot, f);
      return rel !== null && matchesInclude(rel);
    })
    .sort();
  const tsconfigPath = findTsconfig(config.sourceRoot);
  const resolver = new ResolverFactory({
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"],
    conditionNames: ["import", "node", "default"],
    ...(tsconfigPath !== null
      ? { tsconfig: { configFile: tsconfigPath, references: "auto" } }
      : {}),
  });

  const builder = new GraphBuilder({
    host,
    repoRoot: config.repoRoot,
    delivery: "complete",
  });
  const kinds = createModuleKindResolver({ sourceRoot: config.sourceRoot });
  const walked = new Set(files);
  for (const file of files) builder.addModule({ id: file, file, kind: "source" });

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const [imports] = parse(source, file);
    for (const imp of imports) {
      const raw = imp.n;
      if (raw === undefined) continue; // import.meta / computed dynamic specifiers
      if (TYPE_ONLY.test(source.slice(imp.ss, imp.ss + 16))) continue;
      const kind: EdgeKind =
        imp.d > -1 ? "dynamic" : source.startsWith("export", imp.ss) ? "reexport" : "static";
      const loc = offsetToLineCol(source, imp.ss);
      // A builtin resolves to nothing on disk and is not a dependency: the runtime
      // provides it. Collapsing it into "external" is what made `pure` layers reject
      // `node:crypto` as a third-party package.
      if (isBuiltinSpecifier(raw)) {
        builder.addModule({ id: raw, file: null, kind: "builtin", specifier: raw });
        builder.addEdge({
          from: file,
          to: raw,
          rawSpecifier: raw,
          resolvedPath: raw,
          kind,
          loc: { file, line: loc.line, column: loc.column },
        });
        continue;
      }

      const resolved = resolver.sync(path.dirname(file), raw);
      let to: string;
      if (resolved.path) {
        to = resolved.path;
        // Modules in the walked set were already registered as source above; anything
        // else is classified by the same shared policy every other producer uses.
        if (!walked.has(to)) {
          builder.addModule({
            id: to,
            file: to,
            ...kinds.infer({ id: to, file: to }),
          });
        }
      } else {
        // Unresolvable (package not installed, bad path): degrade rather than crash the
        // scan, keyed by the raw specifier since there is no path to key on.
        to = raw;
        builder.addModule({
          id: to,
          file: null,
          specifier: raw,
          ...kinds.infer({
            id: to,
            file: null,
            specifier: raw,
            unresolved: true,
          }),
        });
      }
      builder.addEdge({
        from: file,
        to,
        rawSpecifier: raw,
        resolvedPath: to,
        kind,
        loc: { file, line: loc.line, column: loc.column },
      });
    }
  }
  return builder.build();
}
