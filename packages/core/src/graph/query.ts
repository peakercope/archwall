import type { Edge, EdgeKind, ModuleId, ModuleKind, ModuleNode, ProjectGraph } from "./ir.js";

export interface ModuleFilter {
  /** ALL entries must match module tags. */
  tag?: Record<string, string>;
  /**
   * Any listed kind matches. `FIRST_PARTY_KINDS` / `THIRD_PARTY_KINDS` cover the two
   * groupings that are actually meaningful.
   */
  moduleKind?: ModuleKind | readonly ModuleKind[];
  packageName?: string;
}

export interface EdgeFilter {
  kind?: EdgeKind;
  /** Any listed kind matches, applied to the edge's target. */
  toModuleKind?: ModuleKind | readonly ModuleKind[];
  fromTag?: Record<string, string>;
  toTag?: Record<string, string>;
  /** Tag key; keep edge iff BOTH endpoints have the tag and values differ. */
  crossing?: string;
}

function matchesKind(m: ModuleNode, want: ModuleKind | readonly ModuleKind[]): boolean {
  return typeof want === "string" ? m.kind === want : want.includes(m.kind);
}

function matchesTags(m: ModuleNode, want: Record<string, string>): boolean {
  for (const k of Object.keys(want)) if (m.tags.get(k) !== want[k]) return false;
  return true;
}

const NO_EDGES: readonly Edge[] = [];

/**
 * Stable key for a filter, so the engine can bucket rules that want the same slice of the
 * graph and evaluate that slice once for all of them.
 */
export function filterKey(filter: EdgeFilter | ModuleFilter | undefined): string {
  if (filter === undefined) return "*";
  return JSON.stringify(filter, Object.keys(filter).sort());
}

/**
 * The adjacency and attribute indexes over one graph, built LAZILY per axis.
 *
 * One index serves every query over a graph, scoped or not: a scope narrows *which results
 * are returned*, and does not change what the graph contains, so it must never rebuild the
 * index of it.
 *
 * Each axis is built on first use. A run whose rules only walk edges never pays for the
 * tag, kind, and package indexes.
 */
export class GraphIndex {
  readonly #graph: ProjectGraph;
  #out: Map<ModuleId, Edge[]> | undefined;
  #in: Map<ModuleId, Edge[]> | undefined;
  #byTag: Map<string, ModuleId[]> | undefined;
  #byKind: Map<ModuleKind, ModuleNode[]> | undefined;
  #byPackage: Map<string, ModuleNode[]> | undefined;

  constructor(graph: ProjectGraph) {
    this.#graph = graph;
  }

  #buildAdjacency(): void {
    const out = new Map<ModuleId, Edge[]>();
    const inn = new Map<ModuleId, Edge[]>();
    for (const e of this.#graph.edges()) {
      const o = out.get(e.from);
      if (o) o.push(e);
      else out.set(e.from, [e]);
      const i = inn.get(e.to);
      if (i) i.push(e);
      else inn.set(e.to, [e]);
    }
    this.#out = out;
    this.#in = inn;
  }

  outOf(id: ModuleId): readonly Edge[] {
    if (this.#out === undefined) this.#buildAdjacency();
    return this.#out?.get(id) ?? NO_EDGES;
  }

  into(id: ModuleId): readonly Edge[] {
    if (this.#in === undefined) this.#buildAdjacency();
    return this.#in?.get(id) ?? NO_EDGES;
  }

  byTag(key: string, value: string): readonly ModuleId[] {
    if (this.#byTag === undefined) {
      const index = new Map<string, ModuleId[]>();
      for (const m of this.#graph.modules()) {
        for (const [k, v] of m.tags) {
          const bucket = `${k}\0${v}`;
          const ids = index.get(bucket);
          if (ids) ids.push(m.id);
          else index.set(bucket, [m.id]);
        }
      }
      this.#byTag = index;
    }
    return this.#byTag.get(`${key}\0${value}`) ?? [];
  }

  byKind(kind: ModuleKind): readonly ModuleNode[] {
    if (this.#byKind === undefined) {
      const index = new Map<ModuleKind, ModuleNode[]>();
      for (const m of this.#graph.modules()) {
        const bucket = index.get(m.kind);
        if (bucket) bucket.push(m);
        else index.set(m.kind, [m]);
      }
      this.#byKind = index;
    }
    return this.#byKind.get(kind) ?? [];
  }

  byPackage(name: string): readonly ModuleNode[] {
    if (this.#byPackage === undefined) {
      const index = new Map<string, ModuleNode[]>();
      for (const m of this.#graph.modules()) {
        if (m.packageName === undefined) continue;
        const bucket = index.get(m.packageName);
        if (bucket) bucket.push(m);
        else index.set(m.packageName, [m]);
      }
      this.#byPackage = index;
    }
    return this.#byPackage.get(name) ?? [];
  }
}

/**
 * A set of modules, with the operations a rule actually performs on one.
 *
 * An interface rather than a class: a selection carries the query it came from, and one
 * built by hand against a different graph would answer edge questions about the wrong one.
 * Only {@link GraphQuery} can produce one.
 */
export interface ModuleSelection extends Iterable<ModuleNode> {
  readonly size: number;
  isEmpty(): boolean;
  toArray(): readonly ModuleNode[];
  ids(): ModuleId[];
  forEach(fn: (m: ModuleNode) => void): void;
  /** Chainable: narrows this selection without going back to the graph. */
  filter(predicate: (m: ModuleNode) => boolean): ModuleSelection;
  edgesOut(filter?: EdgeFilter): readonly Edge[];
  /** The mirror of {@link edgesOut}: edges arriving at any module in this selection. */
  edgesIn(filter?: EdgeFilter): readonly Edge[];
}

/**
 * The only sanctioned way to read a graph.
 *
 * A scoped query is a VIEW: it shares the underlying {@link GraphIndex} with the query it
 * came from and differs only in which modules it is *about*.
 *
 * ## What scope does, exactly
 *
 * One rule: **an operation is scoped if and only if it ENUMERATES. An operation that answers a
 * question about a module you named is never scoped.**
 *
 * | Operation | Scoped |
 * |---|---|
 * | `modules`, `moduleIds`, `moduleCount`, `edges` | yes — they enumerate |
 * | `module`, `has`, `tagOf` | no — you named the module |
 * | `edgesOutOf`, `edgesInto` | no — you named the module |
 * | `reachableFrom`, `reaching`, `pathBetween` | no — traversal from a named module |
 * | `ModuleSelection.edgesOut` / `edgesIn` | anchored: endpoints in-selection, edges unfiltered |
 * | `RuleContext.compute` | yes — a computation enumerates |
 *
 * The asymmetry is deliberate rather than incidental. A scoped rule must be able to ask what an
 * out-of-scope import target *is*, because an edge leaving the scope is the most interesting
 * thing it can find; hiding the target would turn `layer-dependencies` under a scope from a
 * finding into silence.
 *
 * See docs/adr/0013-scope-semantics.md.
 */
export class GraphQuery {
  readonly #graph: ProjectGraph;
  readonly #index: GraphIndex;
  /** When present, the ANCHOR set: which modules this view is about. See the class doc. */
  readonly #scope: ReadonlySet<ModuleId> | undefined;
  /** Scoped `edges()` is one filter over the whole edge list; do it once, not per call. */
  #scopedEdges: readonly Edge[] | undefined;

  constructor(graph: ProjectGraph, index?: GraphIndex, scope?: ReadonlySet<ModuleId>) {
    this.#graph = graph;
    this.#index = index ?? new GraphIndex(graph);
    this.#scope = scope;
  }

  /** A view of the same graph restricted to `scope`, sharing this query's index. */
  scoped(scope: ReadonlySet<ModuleId>): GraphQuery {
    return new GraphQuery(this.#graph, this.#index, scope);
  }

  module(id: ModuleId): ModuleNode | undefined {
    return this.#graph.module(id);
  }

  /** Modules in scope, or all of them when unscoped. */
  moduleCount(): number {
    return this.#scope ? this.#scope.size : this.#graph.moduleCount;
  }

  /** Every in-scope module id, in graph order. The traversal primitive. */
  moduleIds(): Iterable<ModuleId> {
    if (!this.#scope) return this.#graph.moduleIds();
    const scope = this.#scope;
    return (function* (ids) {
      for (const id of ids) if (scope.has(id)) yield id;
    })(this.#graph.moduleIds());
  }

  /** Whether the graph contains this module at all — distinct from "is it a source file". */
  has(id: ModuleId): boolean {
    return this.#graph.hasModule(id);
  }

  tagOf(id: ModuleId, key: string): string | undefined {
    return this.#graph.module(id)?.tags.get(key);
  }

  modules(filter?: ModuleFilter): ModuleSelection {
    // Pick the narrowest index the filter allows rather than scanning every module.
    let candidates: Iterable<ModuleNode>;
    const tagEntries = filter?.tag ? Object.entries(filter.tag) : [];
    if (tagEntries.length > 0) {
      const sets = tagEntries
        .map(([k, v]) => this.#index.byTag(k, v))
        .sort((a, b) => a.length - b.length);
      const rest = sets.slice(1).map((ids) => new Set(ids));
      const narrowed: ModuleNode[] = [];
      for (const id of sets[0] ?? []) {
        if (!rest.every((s) => s.has(id))) continue;
        const m = this.#graph.module(id);
        if (m !== undefined) narrowed.push(m);
      }
      candidates = narrowed;
    } else if (filter?.packageName !== undefined) {
      candidates = this.#index.byPackage(filter.packageName);
    } else if (filter?.moduleKind !== undefined) {
      const kinds = typeof filter.moduleKind === "string" ? [filter.moduleKind] : filter.moduleKind;
      candidates =
        kinds.length === 1
          ? this.#index.byKind(kinds[0]!)
          : kinds.flatMap((k) => this.#index.byKind(k) as ModuleNode[]);
    } else {
      candidates = this.#graph.modules();
    }

    const nodes: ModuleNode[] = [];
    for (const m of candidates) {
      if (this.#scope !== undefined && !this.#scope.has(m.id)) continue;
      if (filter?.moduleKind !== undefined && !matchesKind(m, filter.moduleKind)) continue;
      if (filter?.packageName !== undefined && m.packageName !== filter.packageName) continue;
      nodes.push(m);
    }
    return new Selection(this, nodes);
  }

  /**
   * In-scope edges matching `filter`.
   *
   * Returns the graph's own array when nothing narrows it — it is already immutable, so a
   * defensive copy per call would protect nobody and cost a full edge list per rule.
   * See docs/adr/0003-rule-visitor-model.md.
   */
  edges(filter?: EdgeFilter): readonly Edge[] {
    let all: readonly Edge[];
    if (this.#scope === undefined) {
      all = this.#graph.edges();
    } else {
      const scope = this.#scope;
      this.#scopedEdges ??= this.#graph.edges().filter((e) => scope.has(e.from));
      all = this.#scopedEdges;
    }
    return this.filterEdges(all, filter);
  }

  edgesOutOf(id: ModuleId): readonly Edge[] {
    return this.#index.outOf(id);
  }

  edgesInto(id: ModuleId): readonly Edge[] {
    return this.#index.into(id);
  }

  /**
   * Every module reachable from `id` by following edges, excluding `id` itself unless a
   * cycle leads back to it. Iterative: a 10k-module chain would overflow the stack.
   */
  reachableFrom(id: ModuleId, filter?: EdgeFilter): ReadonlySet<ModuleId> {
    const seen = new Set<ModuleId>();
    const stack: ModuleId[] = [id];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const e of this.filterEdges(this.edgesOutOf(current), filter)) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        stack.push(e.to);
      }
    }
    return seen;
  }

  /** The mirror of {@link reachableFrom}: everything that can reach `id`. */
  reaching(id: ModuleId, filter?: EdgeFilter): ReadonlySet<ModuleId> {
    const seen = new Set<ModuleId>();
    const stack: ModuleId[] = [id];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const e of this.filterEdges(this.edgesInto(current), filter)) {
        if (seen.has(e.from)) continue;
        seen.add(e.from);
        stack.push(e.from);
      }
    }
    return seen;
  }

  /**
   * Shortest dependency path from `from` to `to`, inclusive of both, or null. BFS, because
   * the useful evidence for "domain reaches infrastructure" is the shortest chain, not
   * whichever one a traversal happened to find first.
   */
  pathBetween(from: ModuleId, to: ModuleId, filter?: EdgeFilter): readonly ModuleId[] | null {
    if (from === to) return [from];
    const previous = new Map<ModuleId, ModuleId>();
    const queue: ModuleId[] = [from];
    const seen = new Set<ModuleId>([from]);
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i]!;
      for (const e of this.filterEdges(this.edgesOutOf(current), filter)) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        previous.set(e.to, current);
        if (e.to === to) {
          const path: ModuleId[] = [to];
          for (let at = to; previous.has(at); ) {
            at = previous.get(at)!;
            path.push(at);
          }
          return path.reverse();
        }
        queue.push(e.to);
      }
    }
    return null;
  }

  /** Applies an {@link EdgeFilter} to an edge list. Returns the input when there is none. */
  filterEdges(edges: readonly Edge[], filter?: EdgeFilter): readonly Edge[] {
    if (!filter) return edges;
    return edges.filter((e) => this.matchesEdge(e, filter));
  }

  /** Whether one edge satisfies a filter. The unit the engine's visitor dispatch uses. */
  matchesEdge(e: Edge, filter: EdgeFilter): boolean {
    if (filter.kind !== undefined && e.kind !== filter.kind) return false;
    const from = this.#graph.module(e.from);
    const to = this.#graph.module(e.to);
    if (filter.toModuleKind !== undefined && (!to || !matchesKind(to, filter.toModuleKind)))
      return false;
    if (filter.fromTag && (!from || !matchesTags(from, filter.fromTag))) return false;
    if (filter.toTag && (!to || !matchesTags(to, filter.toTag))) return false;
    if (filter.crossing !== undefined) {
      const a = from?.tags.get(filter.crossing);
      const b = to?.tags.get(filter.crossing);
      if (a === undefined || b === undefined || a === b) return false;
    }
    return true;
  }

  /** Whether one module satisfies a filter. Paired with {@link matchesEdge}. */
  matchesModule(m: ModuleNode, filter: ModuleFilter): boolean {
    if (filter.tag && !matchesTags(m, filter.tag)) return false;
    if (filter.moduleKind !== undefined && !matchesKind(m, filter.moduleKind)) return false;
    if (filter.packageName !== undefined && m.packageName !== filter.packageName) return false;
    return true;
  }
}

class Selection implements ModuleSelection {
  constructor(
    private readonly query: GraphQuery,
    private readonly nodes: readonly ModuleNode[],
  ) {}

  [Symbol.iterator](): Iterator<ModuleNode> {
    return this.nodes[Symbol.iterator]();
  }

  get size(): number {
    return this.nodes.length;
  }

  isEmpty(): boolean {
    return this.nodes.length === 0;
  }

  toArray(): readonly ModuleNode[] {
    return this.nodes;
  }

  ids(): ModuleId[] {
    return this.nodes.map((m) => m.id);
  }

  forEach(fn: (m: ModuleNode) => void): void {
    this.nodes.forEach(fn);
  }

  filter(predicate: (m: ModuleNode) => boolean): ModuleSelection {
    return new Selection(this.query, this.nodes.filter(predicate));
  }

  edgesOut(filter?: EdgeFilter): readonly Edge[] {
    const all = this.nodes.flatMap((m) => this.query.edgesOutOf(m.id) as Edge[]);
    return this.query.filterEdges(all, filter);
  }

  edgesIn(filter?: EdgeFilter): readonly Edge[] {
    const all = this.nodes.flatMap((m) => this.query.edgesInto(m.id) as Edge[]);
    return this.query.filterEdges(all, filter);
  }
}
