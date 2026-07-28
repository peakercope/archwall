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
import { barePackageName, isBuiltinSpecifier } from "./specifiers.js";

export interface GraphBuilderOptions {
  host: HostInfo;
  /** Default "complete". */
  delivery?: GraphDelivery;
}

export interface AddModuleInput {
  id: ModuleId;
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
}

export interface AddEdgeInput {
  from: ModuleId;
  to: ModuleId;
  /** Default: to. */
  rawSpecifier?: string;
  /** Default: to. */
  resolvedPath?: string;
  /** Default "static". */
  kind?: EdgeKind;
  loc?: SourceLocation;
}

export { barePackageName, isBuiltinSpecifier } from "./specifiers.js";

export class GraphBuilder {
  readonly #host: HostInfo;
  readonly #delivery: GraphDelivery;
  readonly #modules = new Map<ModuleId, AddModuleInput>();
  readonly #edges: Edge[] = [];
  readonly #edgeKeys = new Set<string>();

  constructor(opts: GraphBuilderOptions) {
    this.#host = opts.host;
    this.#delivery = opts.delivery ?? "complete";
  }

  /** Idempotent by id; later calls merge defined fields over earlier ones. */
  addModule(m: AddModuleInput): this {
    const prev = this.#modules.get(m.id);
    this.#modules.set(m.id, {
      id: m.id,
      ...(prev ?? {}),
      ...(m.file !== undefined ? { file: m.file } : {}),
      ...(m.kind !== undefined ? { kind: m.kind } : {}),
      ...(m.packageName !== undefined ? { packageName: m.packageName } : {}),
      ...(m.workspace !== undefined ? { workspace: m.workspace } : {}),
    });
    return this;
  }

  addEdge(e: AddEdgeInput): this {
    const edge: Edge = {
      from: e.from,
      to: e.to,
      rawSpecifier: e.rawSpecifier ?? e.to,
      resolvedPath: e.resolvedPath ?? e.to,
      kind: e.kind ?? "static",
      ...(e.loc !== undefined ? { loc: e.loc } : {}),
    };
    const key = `${edge.from} ${edge.to} ${edge.rawSpecifier} ${edge.kind}`;
    if (this.#edgeKeys.has(key)) return this;
    this.#edgeKeys.add(key);
    this.#edges.push(edge);
    return this;
  }

  build(): ProjectGraph {
    const modules = new Map<ModuleId, ModuleNode>();
    for (const [id, m] of this.#modules) {
      const kind: ModuleKind = m.kind ?? (m.file === null ? "unresolved" : "source");
      modules.set(id, {
        id,
        // Only first-party code is assumed to live at its own id; a builtin or an
        // unresolved specifier has no file at all.
        file: m.file !== undefined ? m.file : isFirstParty(kind) ? id : null,
        kind,
        ...(m.packageName !== undefined ? { packageName: m.packageName } : {}),
        ...(m.workspace !== undefined ? { workspace: m.workspace } : {}),
        tags: new Map(),
      });
    }
    for (const e of this.#edges) {
      if (!modules.has(e.from)) {
        throw new ArchWallError(
          `GraphBuilder: edge source "${e.from}" was never registered via addModule() — adapter bug.`,
        );
      }
      // Unknown targets are legitimate: an import pointing outside the walked project.
      // Infer the most specific kind the id supports rather than defaulting everything to
      // "package" (which would make purity rules flag Node builtins) or to "unresolved"
      // (which would hide a genuine third-party dependency from every rule about them).
      // Same order of questions `createModuleKindResolver` asks, deliberately.
      if (!modules.has(e.to)) {
        const packageName = barePackageName(e.to);
        const kind: ModuleKind = isBuiltinSpecifier(e.to)
          ? "builtin"
          : packageName !== undefined
            ? "package"
            : "unresolved";
        modules.set(e.to, {
          id: e.to,
          file: null,
          kind,
          ...(kind === "package" && packageName !== undefined ? { packageName } : {}),
          tags: new Map(),
        });
      }
    }
    return ProjectGraph.create({
      host: this.#host,
      delivery: this.#delivery,
      modules,
      edges: [...this.#edges],
    });
  }
}
