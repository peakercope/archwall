import { ArchWallError, IrVersionMismatchError } from "../errors.js";

/** Semver of the Project Graph IR schema itself, independent of package versions. */
export const IR_VERSION = "1.0.0";

/**
 * A module's identity, in the IR's own vocabulary rather than the host's.
 *
 * ```
 * file:<repo-relative-posix-path>   source | workspace | excluded
 * pkg:<name>                        package    — the package, not one of its files
 * builtin:<specifier>               builtin    — always prefixed (builtin:node:fs)
 * virtual:<host>:<opaque>           virtual    — host-synthesized, host-specific by nature
 * unresolved:<raw-specifier>        unresolved
 * ```
 *
 * Producers report host facts; `GraphBuilder` decides identity — the same division
 * {@link ModuleKind} already uses. That is what makes a violation's fingerprint the same under
 * every bundler, which is what makes a baseline file possible at all.
 */
export type ModuleId = string;

/** The schemes {@link ModuleId} recognises. */
export const MODULE_ID_SCHEMES = ["file", "pkg", "builtin", "virtual", "unresolved"] as const;

export type ModuleIdScheme = (typeof MODULE_ID_SCHEMES)[number];

const SCHEME_OF = /^(file|pkg|builtin|virtual|unresolved):/;

/**
 * Splits a canonical id into its scheme and body, or null when it carries no known scheme.
 *
 * Null is a legitimate answer, not an error: in-memory graphs (`@archwall/test-utils`, a
 * playground) use bare ids, and every consumer here degrades to treating the id as opaque.
 */
export function parseModuleId(id: ModuleId): { scheme: ModuleIdScheme; body: string } | null {
  const m = SCHEME_OF.exec(id);
  if (!m) return null;
  const scheme = m[1] as ModuleIdScheme;
  return { scheme, body: id.slice(scheme.length + 1) };
}

/**
 * The id as a human should read it: the path, the package name, the builtin specifier.
 *
 * Used by every reporter and offered to rules as `RuleContext.display`, so that a message names
 * `src/domain/rules.ts` and `react` rather than a scheme-prefixed id — or, as before canonical
 * ids existed, an absolute path from whichever machine produced the graph.
 *
 * `virtual:` keeps its prefix: it is not a path, and the prefix is the only thing that says so.
 */
export function displayModuleId(id: ModuleId): string {
  const parsed = parseModuleId(id);
  if (parsed === null || parsed.scheme === "virtual") return id;
  return parsed.body;
}

export type WellKnownCapability =
  /** `Edge.loc` is populated. */
  | "import-locations"
  /** Dynamic `import()` edges are present and marked `kind: "dynamic"`. */
  | "dynamic-imports"
  /** Every module in the project is present; absence of a module IS evidence. */
  | "complete-graph"
  /** Re-export edges are distinguished from plain imports. */
  | "reexport-edges"
  /**
   * `Edge.rawSpecifier` is what the author wrote, not a copy of the resolved id. A rule
   * that matches on specifiers must require this, or it silently matches nothing on hosts
   * that cannot supply them and reports a clean run rather than an unavailable one.
   */
  | "raw-specifiers"
  /**
   * Type-only edges are PRESENT and carry `attributes.typeOnly`. See {@link EdgeAttributes}.
   *
   * A rule that treats type-only imports differently must require this. Without it, a host
   * that erases type imports (every bundler does) is indistinguishable from one where the
   * code genuinely has no type imports — and "no `attributes.typeOnly` anywhere" would be
   * read as "nothing is type-only" rather than "nobody asked".
   */
  | "type-only-edges";

/**
 * Open union: adapters may declare capabilities core does not know about, and rules may
 * require them, without an IR major. `WellKnownCapability` keeps autocomplete useful for
 * the ones core ships.
 */
export type Capability = WellKnownCapability | (string & {});

export interface HostInfo {
  name: string;
  version: string;
  capabilities: ReadonlySet<Capability>;
}

export interface SourceLocation {
  file: string;
  /** 1-based */
  line: number;
  /** 0-based */
  column: number;
}

export type WellKnownEdgeKind = "static" | "dynamic" | "reexport";

/**
 * Open union so future graph facts (CSS imports, worker edges) arrive additively. Consumers
 * must treat an unrecognised kind as "some dependency exists" — never assume exhaustiveness.
 *
 * `kind` answers ONE question — roughly "what syntax produced this edge" — and deliberately
 * keeps answering only that. Everything else an edge might be belongs in
 * {@link EdgeAttributes}; see the note there for why.
 */
export type EdgeKind = WellKnownEdgeKind | (string & {});

/**
 * Orthogonal facts about an edge, as an OPEN bag.
 *
 * `kind` is one enum, but the domain is not one-dimensional. `export type * from "./x"` is
 * *both* a re-export and type-only; a dynamic import of a barrel is both dynamic and a
 * re-export. Modelling those as one enum forces every producer to pick a winner, and forces
 * every consumer to guess which axis the winner came from.
 *
 * So the axes split: `kind` keeps the syntactic one, and everything else lands here, where it
 * composes. A bag rather than named fields because the next axis is always unknown — import
 * attributes (`with { type: "json" }`), worker edges, CSS edges, `require` vs `import`
 * interop — and each one arriving as a new top-level `Edge` field would be a new IR major.
 *
 * **Absent means "the host did not say", never "false".** That distinction is the whole
 * reason {@link WellKnownCapability} has `type-only-edges`: a bundler that erased type imports
 * before ArchWall saw them reports nothing here, and a rule must be able to tell that apart
 * from a codebase with no type imports in it.
 */
export interface EdgeAttributes {
  /**
   * The import is erased at compile time (`import type`, `export type`, or an
   * `import { type X }` specifier where every named binding is type-only).
   *
   * Requires the `type-only-edges` capability to be meaningful. `true` or absent — never
   * `false`, so that a producer cannot accidentally assert the negative it does not know.
   */
  typeOnly?: true;
  /** Third parties and future core versions extend here without an IR major. */
  [key: string]: string | true | undefined;
}

/**
 * What a module *is*, relative to the project being analysed.
 *
 * - `source`     — a first-party file inside the analysed project
 * - `workspace`  — a file owned by a *different* package in the same monorepo
 * - `package`    — a third-party dependency (node_modules)
 * - `builtin`    — a runtime builtin (`node:fs`, `bun:sqlite`, …)
 * - `virtual`    — generated by the toolchain; no file on disk
 * - `unresolved` — the specifier could not be resolved to anything
 * - `excluded`   — a real project file the config's `exclude` removed from analysis
 *
 * The seven-way split is load-bearing: a purity rule that cannot tell `node:crypto` from
 * `lodash` from `@myorg/shared-kernel` gives the wrong answer for two of the three.
 */
export type ModuleKind =
  | "source"
  | "workspace"
  | "package"
  | "builtin"
  | "virtual"
  | "unresolved"
  | "excluded";

export interface ModuleNode {
  /** Canonical; see {@link ModuleId}. */
  id: ModuleId;
  /**
   * Absolute path, for the kinds that denote a file: `source`, `workspace`, `excluded`.
   *
   * Null for everything else — including `package`, because a dependency is one node
   * (`pkg:react`) rather than one node per file, so there is no single file to name.
   */
  file: string | null;
  kind: ModuleKind;
  /** npm package name, for `kind: "package"`. */
  packageName?: string;
  /** Owning workspace package name, for `kind: "workspace"`. */
  workspace?: string;
  /** Filled by classification, e.g. layer → "features". */
  tags: ReadonlyMap<string, string>;
}

/** Code the project owns and can change — including sibling packages in the monorepo. */
export const FIRST_PARTY_KINDS = ["source", "workspace"] as const satisfies readonly ModuleKind[];

/** A dependency the project does not own: third-party code or a runtime builtin. */
export const THIRD_PARTY_KINDS = ["package", "builtin"] as const satisfies readonly ModuleKind[];

export function isFirstParty(kind: ModuleKind): boolean {
  return kind === "source" || kind === "workspace";
}

export function isThirdParty(kind: ModuleKind): boolean {
  return kind === "package" || kind === "builtin";
}

export interface Edge {
  from: ModuleId;
  to: ModuleId;
  /** What the source wrote: "@/features/auth". */
  rawSpecifier: string;
  /** What it actually is after resolution. */
  resolvedPath: string;
  kind: EdgeKind;
  /** Present only if host capability allows. */
  loc?: SourceLocation;
  /** Orthogonal facts; see {@link EdgeAttributes}. Absent when the host reported none. */
  attributes?: EdgeAttributes;
}

export type GraphDelivery = "complete" | "progressive";

/**
 * Process-local counter behind {@link ProjectGraphInit.revision}.
 *
 * A fresh number per constructed graph is the conservative choice: a consumer keying a cache
 * on `revision` can only ever be told "this is a different graph", never falsely told it is
 * the same one. Content-addressed revisions would enable cache HITS across rebuilds, which is
 * the incremental-validation problem and deliberately not solved here.
 */
let revisionCounter = 0;

export interface ProjectGraphInit {
  host: HostInfo;
  /** Default "complete". */
  delivery?: GraphDelivery;
  modules: Iterable<readonly [ModuleId, ModuleNode]> | ReadonlyMap<ModuleId, ModuleNode>;
  edges: readonly Edge[];
  /** Default {@link IR_VERSION}. Adapters should leave this alone. */
  irVersion?: string;
  /**
   * Opaque identity for this graph. Defaults to a fresh process-local number.
   *
   * The contract is one-directional and deliberately weak: **equal revisions mean the same
   * graph; unequal revisions mean nothing.** Set it explicitly only if you can guarantee the
   * first half — a producer that content-hashes its inputs, for instance.
   */
  revision?: number;
}

/**
 * The module graph, as an OPAQUE handle.
 *
 * The backing stores are private and no accessor hands them out. Everything a consumer
 * legitimately needs is a method here or on `GraphQuery`; if something is missing, the fix
 * is to add a method, never to expose the store.
 *
 * That is what keeps the *representation* out of the IR contract: a `ReadonlyMap` plus an
 * `Edge[]` is the current implementation, not the promise.
 */
export class ProjectGraph {
  readonly irVersion: string;
  readonly host: HostInfo;
  readonly delivery: GraphDelivery;
  /**
   * See {@link ProjectGraphInit.revision}. Preserved across {@link replaceStores}, because a
   * derived graph is a deterministic function of this one and the config that derived it —
   * so a cache keyed on `(revision, configKey)` stays sound through the prepare pipeline.
   */
  readonly revision: number;
  readonly #modules: ReadonlyMap<ModuleId, ModuleNode>;
  readonly #edges: readonly Edge[];

  private constructor(
    irVersion: string,
    host: HostInfo,
    delivery: GraphDelivery,
    revision: number,
    modules: ReadonlyMap<ModuleId, ModuleNode>,
    edges: readonly Edge[],
  ) {
    this.irVersion = irVersion;
    this.host = host;
    this.delivery = delivery;
    this.revision = revision;
    this.#modules = modules;
    this.#edges = edges;
  }

  static create(init: ProjectGraphInit): ProjectGraph {
    const modules =
      init.modules instanceof Map
        ? (init.modules as ReadonlyMap<ModuleId, ModuleNode>)
        : new Map(init.modules as Iterable<readonly [ModuleId, ModuleNode]>);
    return new ProjectGraph(
      init.irVersion ?? IR_VERSION,
      init.host,
      init.delivery ?? "complete",
      init.revision ?? ++revisionCounter,
      modules,
      init.edges,
    );
  }

  get moduleCount(): number {
    return this.#modules.size;
  }

  get edgeCount(): number {
    return this.#edges.length;
  }

  module(id: ModuleId): ModuleNode | undefined {
    return this.#modules.get(id);
  }

  hasModule(id: ModuleId): boolean {
    return this.#modules.has(id);
  }

  /** Every module, in graph order. */
  modules(): Iterable<ModuleNode> {
    return this.#modules.values();
  }

  /** Every module id, in graph order. */
  moduleIds(): Iterable<ModuleId> {
    return this.#modules.keys();
  }

  /** Every edge, in graph order. Never copy this — it is already immutable. */
  edges(): readonly Edge[] {
    return this.#edges;
  }

  /**
   * A new graph with replaced stores, same identity fields.
   *
   * @internal Engine and {@link GraphDraft} only. Not part of the IR contract.
   */
  replaceStores(modules: ReadonlyMap<ModuleId, ModuleNode>, edges?: readonly Edge[]): ProjectGraph {
    return new ProjectGraph(
      this.irVersion,
      this.host,
      this.delivery,
      this.revision,
      modules,
      edges ?? this.#edges,
    );
  }
}

/**
 * The write surface a {@link GraphTransform} gets.
 *
 * A transform adds, patches, and removes; it never constructs a graph. That is what keeps
 * {@link ProjectGraph} opaque in practice rather than only in principle, and it means a
 * transform cannot drop an IR field it does not know about.
 */
export interface GraphMutation {
  /** Read side, mirroring {@link ProjectGraph}. */
  module(id: ModuleId): ModuleNode | undefined;
  hasModule(id: ModuleId): boolean;
  modules(): Iterable<ModuleNode>;
  edges(): readonly Edge[];
  /** Adds a module, or replaces one with the same id. */
  addModule(node: ModuleNode): void;
  /** Merges fields into an existing module; `tags` merge key-by-key. No-op if absent. */
  patchModule(
    id: ModuleId,
    patch: Partial<Omit<ModuleNode, "id" | "tags">> & { tags?: Record<string, string> },
  ): void;
  addEdge(edge: Edge): void;
  /** Removes every edge the predicate accepts. */
  removeEdges(predicate: (edge: Edge) => boolean): void;
}

/**
 * Copy-on-write {@link GraphMutation} over a {@link ProjectGraph}.
 *
 * A transform that touches nothing costs nothing: the stores are only cloned on the first
 * write, and `commit()` returns the original graph when there were none.
 *
 * @internal
 */
export class GraphDraft implements GraphMutation {
  readonly #base: ProjectGraph;
  #modules: Map<ModuleId, ModuleNode> | undefined;
  #edges: Edge[] | undefined;

  constructor(base: ProjectGraph) {
    this.#base = base;
  }

  #mutableModules(): Map<ModuleId, ModuleNode> {
    if (this.#modules === undefined) {
      this.#modules = new Map();
      for (const m of this.#base.modules()) this.#modules.set(m.id, m);
    }
    return this.#modules;
  }

  #mutableEdges(): Edge[] {
    this.#edges ??= [...this.#base.edges()];
    return this.#edges;
  }

  module(id: ModuleId): ModuleNode | undefined {
    return this.#modules ? this.#modules.get(id) : this.#base.module(id);
  }

  hasModule(id: ModuleId): boolean {
    return this.#modules ? this.#modules.has(id) : this.#base.hasModule(id);
  }

  modules(): Iterable<ModuleNode> {
    return this.#modules ? this.#modules.values() : this.#base.modules();
  }

  edges(): readonly Edge[] {
    return this.#edges ?? this.#base.edges();
  }

  addModule(node: ModuleNode): void {
    this.#mutableModules().set(node.id, node);
  }

  patchModule(
    id: ModuleId,
    patch: Partial<Omit<ModuleNode, "id" | "tags">> & { tags?: Record<string, string> },
  ): void {
    const current = this.module(id);
    if (current === undefined) return;
    const { tags: tagPatch, ...rest } = patch;
    const next: ModuleNode = { ...current, ...rest };
    if (tagPatch !== undefined) {
      const tags = new Map(current.tags);
      for (const [k, v] of Object.entries(tagPatch)) tags.set(k, v);
      next.tags = tags;
    }
    this.#mutableModules().set(id, next);
  }

  addEdge(edge: Edge): void {
    this.#mutableEdges().push(edge);
  }

  removeEdges(predicate: (edge: Edge) => boolean): void {
    const kept = this.edges().filter((e) => !predicate(e));
    if (kept.length !== this.edges().length) this.#edges = kept;
  }

  /** The resulting graph, or the untouched original when nothing was written. */
  commit(): ProjectGraph {
    if (this.#modules === undefined && this.#edges === undefined) return this.#base;
    const modules =
      this.#modules ??
      new Map<ModuleId, ModuleNode>([...this.#base.modules()].map((m) => [m.id, m]));
    return this.#base.replaceStores(modules, this.#edges);
  }
}

export function irMajor(version: string): number {
  const m = /^(\d+)\./.exec(version);
  if (!m) throw new ArchWallError(`Malformed IR version: "${version}"`);
  return Number(m[1]);
}

export function assertIrCompatible(graphVersion: string): void {
  if (irMajor(graphVersion) !== irMajor(IR_VERSION)) {
    throw new IrVersionMismatchError(graphVersion, IR_VERSION);
  }
}
