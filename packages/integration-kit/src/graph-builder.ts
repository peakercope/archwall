import type {
  Edge,
  EdgeKind,
  GraphDelivery,
  HostInfo,
  ModuleId,
  ModuleKind,
  ModuleNode,
  SourceLocation,
} from "@archwall/core";
import { ArchWallError, isFirstParty, ProjectGraph } from "@archwall/core";
import { canonicalModuleId, identifiesAFile } from "./canonical-id.js";
import { BUILT_IR_VERSION } from "./ir-version.js";
import { barePackageName, isBuiltinSpecifier } from "./specifiers.js";

export interface GraphBuilderOptions {
  host: HostInfo;
  /**
   * Absolute repository root. Required, not optional: it is the base every `file:` id is
   * relative to, and a builder that guessed it would produce ids — and therefore violation
   * fingerprints — that silently differ from every other producer's.
   */
  repoRoot: string;
  /** Default "complete". */
  delivery?: GraphDelivery;
  /**
   * IR version to stamp on the graph. Defaults to the version this package was BUILT
   * against, which is what makes `assertIrCompatible` able to detect adapter/core skew.
   *
   * Set it only if you are a third-party adapter that compiles its own IR version in; a
   * value from a runtime `IR_VERSION` import defeats the check.
   */
  irVersion?: string;
}

export interface AddModuleInput {
  /** The HOST's id. `build()` translates it into a canonical {@link ModuleId}. */
  id: string;
  file?: string | null;
  /**
   * What this module *is*. Adapters should always set it — the classification is
   * something only the host knows, and rules depend on it (a purity rule must be able
   * to tell `node:crypto` from `lodash`). Defaults to "source", or "unresolved" when
   * the module has no file.
   */
  kind?: ModuleKind;
  /** npm package name, for `kind: "package"`. */
  packageName?: string;
  /** Owning workspace package, for `kind: "workspace"`. */
  workspace?: string;
  /**
   * The bare specifier behind a module with no file, where the host encodes one
   * (`external "react"`, a metafile external path, a lexed import). Load-bearing for identity:
   * it is the only evidence that separates `builtin:node:fs` from `pkg:some-package`.
   */
  specifier?: string;
}

export interface AddEdgeInput {
  /** Host ids, both. Translated by `build()`. */
  from: string;
  to: string;
  /** Default: the target's canonical id. */
  rawSpecifier?: string;
  /** Default: the target's canonical id. */
  resolvedPath?: string;
  /** Default "static". */
  kind?: EdgeKind;
  loc?: SourceLocation;
}

interface PendingEdge {
  from: string;
  to: string;
  rawSpecifier: string | undefined;
  resolvedPath: string | undefined;
  kind: EdgeKind;
  loc?: SourceLocation;
}

export { barePackageName, isBuiltinSpecifier } from "./specifiers.js";

/**
 * Collects host facts, then hands back a graph in the IR's own terms.
 *
 * Producers add modules and edges keyed by whatever their host calls them; `build()` is the one
 * choke point where those become canonical {@link ModuleId}s. That single translation is what
 * makes two bundlers report the same violation with the same fingerprint — and therefore what
 * makes a baseline file possible.
 */
export class GraphBuilder {
  readonly #host: HostInfo;
  readonly #repoRoot: string;
  readonly #delivery: GraphDelivery;
  readonly #irVersion: string;
  readonly #modules = new Map<string, AddModuleInput>();
  readonly #edges: PendingEdge[] = [];
  readonly #edgeKeys = new Set<string>();

  constructor(opts: GraphBuilderOptions) {
    this.#host = opts.host;
    this.#repoRoot = opts.repoRoot;
    this.#delivery = opts.delivery ?? "complete";
    this.#irVersion = opts.irVersion ?? BUILT_IR_VERSION;
  }

  /** Idempotent by host id; later calls merge defined fields over earlier ones. */
  addModule(m: AddModuleInput): this {
    const prev = this.#modules.get(m.id);
    this.#modules.set(m.id, {
      id: m.id,
      ...(prev ?? {}),
      ...(m.file !== undefined ? { file: m.file } : {}),
      ...(m.kind !== undefined ? { kind: m.kind } : {}),
      ...(m.packageName !== undefined ? { packageName: m.packageName } : {}),
      ...(m.workspace !== undefined ? { workspace: m.workspace } : {}),
      ...(m.specifier !== undefined ? { specifier: m.specifier } : {}),
    });
    return this;
  }

  addEdge(e: AddEdgeInput): this {
    const key = `${e.from} ${e.to} ${e.rawSpecifier ?? ""} ${e.kind ?? "static"}`;
    if (this.#edgeKeys.has(key)) return this;
    this.#edgeKeys.add(key);
    this.#edges.push({
      from: e.from,
      to: e.to,
      rawSpecifier: e.rawSpecifier,
      resolvedPath: e.resolvedPath,
      kind: e.kind ?? "static",
      ...(e.loc !== undefined ? { loc: e.loc } : {}),
    });
    return this;
  }

  /**
   * Shape for a module the producer never registered but pointed an edge at.
   *
   * Unknown targets are legitimate: an import pointing outside the walked project. Infer the most
   * specific kind the id supports rather than defaulting everything to "package" (which would make
   * purity rules flag Node builtins) or to "unresolved" (which would hide a genuine third-party
   * dependency from every rule about them). Same order of questions `createModuleKindResolver`
   * asks, deliberately.
   */
  #inferUnregistered(hostId: string): AddModuleInput {
    if (isBuiltinSpecifier(hostId)) {
      return { id: hostId, file: null, kind: "builtin", specifier: hostId };
    }
    const packageName = barePackageName(hostId);
    if (packageName !== undefined) {
      return { id: hostId, file: null, kind: "package", packageName, specifier: hostId };
    }
    return { id: hostId, file: null, kind: "unresolved", specifier: hostId };
  }

  build(): ProjectGraph {
    const inputs = new Map(this.#modules);
    for (const e of this.#edges) {
      if (!inputs.has(e.from)) {
        throw new ArchWallError(
          `GraphBuilder: edge source "${e.from}" was never registered via addModule() — adapter bug.`,
        );
      }
      if (!inputs.has(e.to)) inputs.set(e.to, this.#inferUnregistered(e.to));
    }

    // --- host id → canonical id ----------------------------------------------------------
    const canonical = new Map<string, ModuleId>();
    const modules = new Map<ModuleId, ModuleNode>();
    for (const [hostId, m] of inputs) {
      const kind: ModuleKind = m.kind ?? (m.file === null ? "unresolved" : "source");
      // Only first-party code is assumed to live at its own id; a builtin or an unresolved
      // specifier has no file at all.
      const file = m.file !== undefined ? m.file : isFirstParty(kind) ? hostId : null;
      const id = canonicalModuleId(
        {
          id: hostId,
          file,
          kind,
          ...(m.packageName !== undefined ? { packageName: m.packageName } : {}),
          ...(m.specifier !== undefined ? { specifier: m.specifier } : {}),
        },
        { repoRoot: this.#repoRoot, hostName: this.#host.name },
      );
      canonical.set(hostId, id);

      // Several host modules can collapse onto one canonical id — every file of a dependency
      // becomes `pkg:<name>`. Merge rather than overwrite, so a later and less-informed entry
      // cannot erase a package name an earlier one worked out.
      const prev = modules.get(id);
      const packageName = m.packageName ?? prev?.packageName;
      const workspace = m.workspace ?? prev?.workspace;
      modules.set(id, {
        id,
        // A node that is not a file does not get one: `pkg:react` is the package, not whichever
        // of its files the host happened to mention first.
        file: identifiesAFile(kind) ? file : null,
        kind: prev?.kind ?? kind,
        ...(packageName !== undefined ? { packageName } : {}),
        ...(workspace !== undefined ? { workspace } : {}),
        tags: prev?.tags ?? new Map(),
      });
    }

    // --- edges, rewritten and re-deduplicated --------------------------------------------
    const edges: Edge[] = [];
    const seen = new Set<string>();
    for (const e of this.#edges) {
      // Both endpoints were registered in `inputs` above, so both are in the map.
      const from = canonical.get(e.from);
      const to = canonical.get(e.to);
      if (from === undefined || to === undefined) continue;
      // Collapsing a dependency to one node turns its internal imports into self-edges. Those
      // are an artifact of the collapse, not something the author wrote, so they go — while a
      // genuine self-import (the same module before translation too) is a real finding and stays.
      if (from === to && e.from !== e.to) continue;
      const edge: Edge = {
        from,
        to,
        rawSpecifier: e.rawSpecifier ?? to,
        resolvedPath:
          e.resolvedPath === undefined ? to : (canonical.get(e.resolvedPath) ?? e.resolvedPath),
        kind: e.kind,
        ...(e.loc !== undefined ? { loc: e.loc } : {}),
      };
      const key = `${edge.from} ${edge.to} ${edge.rawSpecifier} ${edge.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(edge);
    }

    return ProjectGraph.create({
      host: this.#host,
      delivery: this.#delivery,
      irVersion: this.#irVersion,
      modules,
      edges,
    });
  }
}
