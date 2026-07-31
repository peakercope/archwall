import type { Edge, ModuleKind, ModuleNode, Violation } from "@archwall/core";
import { primaryEdge, primaryModule } from "@archwall/core";

/**
 * Canonical module ids, verbatim — `file:shared/lib/bad.ts`, `pkg:react`.
 *
 * There used to be a normalisation step here, collapsing an external to its package name so that
 * a host which resolved `react` into node_modules compared equal to one which left the bare
 * specifier. That helper was the evidence that identity did not belong to the producers; it is
 * gone, and the suite now compares what the IR actually says.
 */
export interface ExpectedViolationAt {
  rule: string;
  from: string;
  to: string;
}

/**
 * Canonical expected violations for the shared fsd-app fixture, which lives next to
 * this file in `packages/integration-kit/fixtures/fsd-app`.
 * Every adapter — Vite, CLI, future bundlers — must reproduce exactly this set.
 */
export const FSD_APP_EXPECTED: ExpectedViolationAt[] = [
  {
    rule: "layer-dependencies",
    from: "file:src/shared/lib/bad.ts",
    to: "file:src/widgets/header/index.ts",
  },
  {
    rule: "feature-isolation",
    from: "file:src/features/cart/model/cart.ts",
    to: "file:src/features/auth/model/store.ts",
  },
  {
    rule: "public-api",
    from: "file:src/features/cart/model/cart.ts",
    to: "file:src/features/auth/model/store.ts",
  },
];

/**
 * Expected violations for `fixtures/layered-app` (the `layered` preset). The purity
 * entry is the interesting one for adapters: it requires the host to surface external
 * packages in the graph with a usable package name.
 */
export const LAYERED_APP_EXPECTED: ExpectedViolationAt[] = [
  {
    rule: "layer-dependencies",
    from: "file:src/application/audit.ts",
    to: "file:src/infrastructure/user-repository.ts",
  },
  // The purity entry is the interesting one: `pkg:react` is what every host must agree on,
  // whether it resolved the import into node_modules or left it as a bare specifier.
  { rule: "forbidden-dependencies", from: "file:src/domain/rules.ts", to: "pkg:react" },
];

/** Expected violations for `fixtures/modules-app` (the `modules` preset). */
export const MODULES_APP_EXPECTED: ExpectedViolationAt[] = [
  {
    rule: "public-api",
    from: "file:src/main.ts",
    to: "file:src/modules/identity/model/user.ts",
  },
  {
    rule: "friend-modules",
    from: "file:src/modules/reporting/model/report.ts",
    to: "file:src/modules/billing/model/invoice.ts",
  },
  {
    rule: "public-api",
    from: "file:src/modules/reporting/model/report.ts",
    to: "file:src/modules/billing/model/invoice.ts",
  },
];

function key(rule: string, from: string, to: string): string {
  return `${rule}|${from}|${to}`;
}

/**
 * A normalized view of the IR itself: what each module IS, and what kind of dependency
 * each edge is.
 *
 * The suite compared `{ruleName, from, to}` and nothing else — not edge kinds, not module
 * kinds, not the graph. A third-party adapter could therefore certify as conformant while
 * producing a materially wrong IR: mislabelling every dynamic import as static, or every
 * builtin as a package, changes no violation in these three fixtures but breaks the
 * purity and cycle rules for everyone else. For a suite that is meant to be *the*
 * compatibility ratchet, comparing only the end result is comparing the wrong thing.
 */
export interface GraphSnapshot {
  /** `"<path-or-package>": "<kind>"`, sorted by key. */
  modules: Record<string, ModuleKind>;
  /** `"<from> -> <to> (<kind>)"`, sorted. */
  edges: string[];
}

/**
 * Normalizes a graph for cross-producer comparison.
 *
 * Externals collapse to their package name and virtual/unresolved ids are kept verbatim,
 * for the same reason violations do: one adapter resolves `react` to a file under
 * node_modules while another keeps the bare specifier, and both are equally correct.
 *
 * `raw` specifiers are deliberately NOT part of the snapshot — a host may or may not have
 * the `raw-specifiers` capability, and requiring them here would fail an adapter for a
 * limitation it correctly declared.
 */
export interface GraphSnapshotOptions {
  /**
   * `"exact"` keeps every edge kind as reported. `"coarse"` (the default) folds `reexport`
   * into `static`.
   *
   * Coarse is the right default for CROSS-producer comparison: `reexport-edges` is a
   * declared capability, so a host that cannot distinguish a re-export from a plain import
   * is correct to report `static`, and failing it for that would punish an adapter for
   * honestly declaring its limits. `dynamic` is never folded — it is not capability-gated,
   * and it changes what `no-cycles` reports.
   */
  edgeKinds?: "exact" | "coarse";
}

/**
 * Anything a snapshot can be taken of: a `ProjectGraph`, or the `GraphQuery` a rule holds.
 *
 * Structural on purpose. An adapter author verifying conformance from inside a probe rule
 * has a query, not a graph, and requiring a `ProjectGraph` forced them to reconstruct one
 * by hand — which meant hand-writing the very representation the IR keeps private.
 */
export interface ReadableGraph {
  modules(): Iterable<ModuleNode>;
  edges(): readonly Edge[];
}

/**
 * Modules and edges keyed by canonical {@link ModuleId}, so two producers can be compared
 * directly. No `root` parameter: identity is a property of the IR, not something a comparison
 * derives.
 */
export function graphSnapshot(
  graph: ReadableGraph,
  opts: GraphSnapshotOptions = {},
): GraphSnapshot {
  const coarse = (opts.edgeKinds ?? "coarse") === "coarse";
  const kindOf = (kind: string): string => (coarse && kind === "reexport" ? "static" : kind);

  // Virtual modules are EXCLUDED, along with every edge touching one.
  //
  // They are host runtime helpers — Vite injects `vite/preload-helper.js` for a dynamic
  // import, other bundlers inject their own or none — and demanding agreement on them
  // would fail a correct adapter for a detail that says nothing about the user's
  // architecture. What must agree is the shape of the code the user wrote.
  const virtual = new Set<string>();
  for (const m of graph.modules()) if (m.kind === "virtual") virtual.add(m.id);

  const modules: Record<string, ModuleKind> = {};
  for (const m of graph.modules()) {
    if (m.kind === "virtual") continue;
    modules[m.id] = m.kind;
  }

  return {
    modules: Object.fromEntries(Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))),
    edges: graph
      .edges()
      .filter((e) => !virtual.has(e.from) && !virtual.has(e.to))
      .map((e) => `${e.from} -> ${e.to} (${kindOf(e.kind)})`)
      .sort(),
  };
}

/**
 * Asserts two producers built the same IR, reporting the specific divergence rather than
 * dumping both graphs.
 */
export function assertGraphsMatch(
  actual: GraphSnapshot,
  expected: GraphSnapshot,
  label = "graph",
): void {
  const problems: string[] = [];
  const keys = new Set([...Object.keys(actual.modules), ...Object.keys(expected.modules)]);
  for (const k of [...keys].sort()) {
    const a = actual.modules[k];
    const b = expected.modules[k];
    if (a !== b) problems.push(`module "${k}": ${a ?? "(absent)"} vs ${b ?? "(absent)"}`);
  }
  const edgeSet = new Set([...actual.edges, ...expected.edges]);
  for (const e of [...edgeSet].sort()) {
    const inA = actual.edges.includes(e);
    const inB = expected.edges.includes(e);
    if (inA !== inB) problems.push(`edge ${e}: ${inA ? "only in actual" : "only in expected"}`);
  }
  if (problems.length > 0) {
    throw new Error(`${label} does not match:\n  ${problems.join("\n  ")}`);
  }
}

/**
 * Reduces violations to {rule, from, to} over canonical ids and compares as sorted sets;
 * throws listing both sides on mismatch.
 */
export function assertViolationsMatch(
  violations: readonly Violation[],
  expected: ExpectedViolationAt[],
): void {
  const actual = violations
    .map((v) => {
      const edge = primaryEdge(v);
      return key(v.ruleName, edge?.from ?? primaryModule(v) ?? "", edge?.to ?? "");
    })
    .sort();
  const wanted = expected.map((e) => key(e.rule, e.from, e.to)).sort();
  if (actual.length === wanted.length && actual.every((a, i) => a === wanted[i])) return;
  throw new Error(
    `Violations do not match expectations.\nExpected:\n  ${wanted.join("\n  ") || "(none)"}\nActual:\n  ${actual.join("\n  ") || "(none)"}`,
  );
}
