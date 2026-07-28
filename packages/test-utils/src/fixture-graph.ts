import type {
  Capability,
  Edge,
  EdgeKind,
  GraphDelivery,
  ModuleId,
  ModuleKind,
  ModuleNode,
  SourceLocation,
} from "@archwall/core";
import { isFirstParty, ProjectGraph } from "@archwall/core";

export interface FixtureModule {
  id: string;
  /** Defaults to id for first-party kinds, null otherwise. */
  file?: string | null;
  /** Default "source". */
  kind?: ModuleKind;
  packageName?: string;
  workspace?: string;
  tags?: Record<string, string>;
}

export interface FixtureEdge {
  from: string;
  to: string;
  /** Default: to. */
  rawSpecifier?: string;
  /** Default: to. */
  resolvedPath?: string;
  /** Default "static". */
  kind?: EdgeKind;
  loc?: SourceLocation;
}

export interface FixtureGraphOptions {
  /** Bare string ⇒ `{ id: string }`. */
  modules: (FixtureModule | string)[];
  /** Tuple ⇒ `{ from, to }`. */
  edges?: ([string, string] | FixtureEdge)[];
  /** Default: all capabilities. */
  capabilities?: Capability[];
  delivery?: GraphDelivery;
  hostName?: string;
}

const ALL_CAPABILITIES: Capability[] = [
  "import-locations",
  "dynamic-imports",
  "complete-graph",
  "reexport-edges",
  "raw-specifiers",
];

export function buildFixtureGraph(opts: FixtureGraphOptions): ProjectGraph {
  const modules = new Map<ModuleId, ModuleNode>();
  for (const entry of opts.modules) {
    const m: FixtureModule = typeof entry === "string" ? { id: entry } : entry;
    const kind: ModuleKind = m.kind ?? "source";
    modules.set(m.id, {
      id: m.id,
      file: m.file !== undefined ? m.file : isFirstParty(kind) ? m.id : null,
      kind,
      ...(m.packageName !== undefined ? { packageName: m.packageName } : {}),
      ...(m.workspace !== undefined ? { workspace: m.workspace } : {}),
      tags: new Map(Object.entries(m.tags ?? {})),
    });
  }
  const edges: Edge[] = (opts.edges ?? []).map((entry) => {
    const e: FixtureEdge = Array.isArray(entry) ? { from: entry[0], to: entry[1] } : entry;
    return {
      from: e.from,
      to: e.to,
      rawSpecifier: e.rawSpecifier ?? e.to,
      resolvedPath: e.resolvedPath ?? e.to,
      kind: e.kind ?? "static",
      ...(e.loc !== undefined ? { loc: e.loc } : {}),
    };
  });
  return ProjectGraph.create({
    host: {
      name: opts.hostName ?? "test",
      version: "0.0.0",
      capabilities: new Set(opts.capabilities ?? ALL_CAPABILITIES),
    },
    delivery: opts.delivery ?? "complete",
    modules,
    edges,
  });
}
