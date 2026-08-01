import * as fs from "node:fs";
import * as path from "node:path";
import type { Diagnostic, EdgeKind, HostInfo, ProjectGraph, ResolvedConfig } from "@archwall/core";
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
    // wrote — the strongest position of any producer. It is also the only producer that sees
    // `import type` at all: every bundler erases it long before a plugin hook could observe it.
    capabilities: new Set([
      "complete-graph",
      "dynamic-imports",
      "import-locations",
      "reexport-edges",
      "raw-specifiers",
      "type-only-edges",
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

/**
 * A statement-level `import type` / `export type`.
 *
 * Deliberately does NOT catch per-specifier `import { type A }`: distinguishing "every named
 * binding is type-only" from "some are" needs a parser, not a lexer, and claiming the
 * attribute on a guess is worse than omitting it — absent means "not asserted", and that is
 * the honest answer here. Such an edge is reported as an ordinary value edge, which is the
 * safe direction to be wrong in: a rule sees a dependency that erases at build time, rather
 * than missing one that does not.
 */
const TYPE_ONLY = /^(import|export)\s+type[\s{*]/;

/**
 * What this scanner can lex. A bundler adapter has no equivalent — its host already
 * decided what a module is — which is exactly why this list must not live in the shared
 * config as `include`.
 */
const SCANNABLE = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];

/** Everything under the boundary, so the two globs can be differenced. */
const ANY_FILE = ["**/*"];

/** Cap on the paths named in the diagnostic; the count carries the rest. */
const SAMPLE_LIMIT = 5;

/**
 * What the scanner produced, and what it could not.
 *
 * A graph alone was the wrong return type: this producer is the only one that ENUMERATES a
 * tree, so it is the only one that can discover files it cannot read — and a producer with no
 * way to say so has no choice but to stay silent about them.
 */
export interface ScanResult {
  graph: ProjectGraph;
  /** `unscannable-files` when the boundary contains files this scanner cannot lex. */
  diagnostics: Diagnostic[];
}

/**
 * Files inside the boundary that this scanner cannot open, as a diagnostic.
 *
 * This closes the CLI's version of the failure mode the engine's `empty-project` and
 * `no-modules-classified` audits exist for. A `.vue` component importing a forbidden module
 * was caught under the Vite adapter and INVISIBLE under the CLI — no module, no edge, no
 * warning, a green CI run over a codebase half of which was never read. Silence is the one
 * outcome this tool must never produce.
 */
function unscannableDiagnostic(
  sourceRoot: string,
  allFiles: readonly string[],
  scanned: ReadonlySet<string>,
): Diagnostic | null {
  const missed = allFiles.filter((f) => !scanned.has(f));
  if (missed.length === 0) return null;

  const byExtension = new Map<string, number>();
  for (const f of missed) {
    const ext = path.extname(f) || "(no extension)";
    byExtension.set(ext, (byExtension.get(ext) ?? 0) + 1);
  }
  const extensions = [...byExtension.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([ext]) => ext);
  const sample = missed.slice(0, SAMPLE_LIMIT).map((f) => sourceRelative(sourceRoot, f) ?? f);

  return {
    code: "unscannable-files",
    severity: "warn",
    message:
      `${missed.length} file(s) inside the project boundary could not be read by the CLI scanner, ` +
      `so they are absent from the graph entirely — no module, no edges, and no rule ever saw them. ` +
      `Extensions: ${extensions.join(", ")}. For example: ${sample.join(", ")}. ` +
      `The CLI lexes JavaScript and TypeScript only; single-file component formats (.vue, .svelte, .astro) ` +
      `need a bundler adapter, whose compiler already knows how to read them. ` +
      `Add these paths to \`exclude\` if they are genuinely out of scope, or run ArchWall through your bundler for full coverage.`,
    details: { count: missed.length, extensions, sample },
  };
}

/**
 * The CLI's own graph producer: walk include globs, lex imports, resolve like the
 * toolchain would (tsconfig paths included).
 */
export async function buildGraphFromFilesystem(
  config: ResolvedConfig,
  host: HostInfo,
): Promise<ScanResult> {
  await init;
  // Two different questions, deliberately answered separately:
  //   SCANNABLE — which files can this scanner open and lex at all. Only the CLI has to
  //     ask it, because only the CLI enumerates a directory tree; a bundler adapter is
  //     handed a graph whose membership the compiler already decided.
  //   include/exclude — which modules are part of the project. The ENGINE applies these
  //     to the graph, so every host agrees; re-applying them here is purely an
  //     optimization that avoids reading files the engine would discard.
  const matchesInclude = picomatch(config.include, { dot: true });
  const inBoundary = (f: string): boolean => {
    const rel = sourceRelative(config.sourceRoot, f);
    return rel !== null && matchesInclude(rel);
  };
  const globOptions = { cwd: config.sourceRoot, ignore: config.exclude, absolute: true } as const;

  // Both walks share `ignore` and `include`, so their DIFFERENCE is exactly "in the project,
  // and unreadable" — never "correctly excluded".
  const [found, everything] = await Promise.all([
    glob(SCANNABLE, globOptions),
    glob(ANY_FILE, globOptions),
  ]);
  const files = found.filter(inBoundary).sort();
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
      // LABELLED, not dropped. Erasure is a policy question the engine answers via
      // `dropTypeOnlyEdges()`, not one a producer gets to settle for everybody — dropping here
      // is what made the CLI silently disagree with every bundler adapter about what the graph
      // even contains, with no way for a user to get the edges back.
      const typeOnly = TYPE_ONLY.test(source.slice(imp.ss, imp.ss + 20));
      const attributes = typeOnly ? ({ typeOnly: true } as const) : undefined;
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
          ...(attributes !== undefined ? { attributes } : {}),
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
        ...(attributes !== undefined ? { attributes } : {}),
      });
    }
  }

  const unscannable = unscannableDiagnostic(
    config.sourceRoot,
    everything.filter(inBoundary).sort(),
    new Set(files),
  );
  return {
    graph: builder.build(),
    diagnostics: unscannable === null ? [] : [unscannable],
  };
}
