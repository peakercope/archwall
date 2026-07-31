import {
  analyze,
  configureRule,
  defineGraphComputation,
  defineRule,
  GraphQuery,
  primaryModule,
  resolveConfig,
} from "@archwall/core";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

/**
 * One test per row of the scope table in `GraphQuery`'s doc comment.
 *
 * The rule is: an operation is scoped iff it ENUMERATES; an operation about a module you named
 * is never scoped. Three different behaviours used to coexist here with nothing stating which
 * applied where, which is survivable at eight built-in rules and a bug factory at fifty.
 */

//   web/a ──► web/b
//     │
//     └─────► api/x ──► api/y ──► web/a   (cycle spanning both scopes)
const graph = () =>
  buildFixtureGraph({
    modules: [
      { id: "/repo/web/a.ts", tags: { area: "web" } },
      { id: "/repo/web/b.ts", tags: { area: "web" } },
      { id: "/repo/api/x.ts", tags: { area: "api" } },
      { id: "/repo/api/y.ts", tags: { area: "api" } },
    ],
    edges: [
      ["/repo/web/a.ts", "/repo/web/b.ts"],
      ["/repo/web/a.ts", "/repo/api/x.ts"],
      ["/repo/api/x.ts", "/repo/api/y.ts"],
      ["/repo/api/y.ts", "/repo/web/a.ts"],
    ],
  });

const WEB = new Set(["/repo/web/a.ts", "/repo/web/b.ts"]);
const scoped = () => new GraphQuery(graph()).scoped(WEB);

describe("enumeration is scoped", () => {
  it("modules() yields only in-scope modules", () => {
    expect(scoped().modules().ids().sort()).toEqual(["/repo/web/a.ts", "/repo/web/b.ts"]);
  });

  it("moduleIds() yields only in-scope ids", () => {
    expect([...scoped().moduleIds()].sort()).toEqual(["/repo/web/a.ts", "/repo/web/b.ts"]);
  });

  it("moduleCount() counts only in-scope modules", () => {
    expect(scoped().moduleCount()).toBe(2);
    expect(new GraphQuery(graph()).moduleCount()).toBe(4);
  });

  it("edges() yields only edges LEAVING an in-scope module, including those that exit the scope", () => {
    // The out-of-scope target is the point: an edge leaving the scope is the most interesting
    // thing a scoped rule can find, so it must not be filtered out.
    expect(
      scoped()
        .edges()
        .map((e) => `${e.from} -> ${e.to}`)
        .sort(),
    ).toEqual(["/repo/web/a.ts -> /repo/api/x.ts", "/repo/web/a.ts -> /repo/web/b.ts"]);
  });
});

describe("questions about a named module are not scoped", () => {
  it("module() answers about an out-of-scope module", () => {
    expect(scoped().module("/repo/api/x.ts")?.id).toBe("/repo/api/x.ts");
  });

  it("has() answers about an out-of-scope module", () => {
    expect(scoped().has("/repo/api/x.ts")).toBe(true);
  });

  it("tagOf() answers about an out-of-scope module", () => {
    // Without this, a scoped `layer-dependencies` could not tell what layer it was importing.
    expect(scoped().tagOf("/repo/api/x.ts", "area")).toBe("api");
  });

  it("edgesOutOf() returns a named module's edges regardless of scope", () => {
    expect(scoped().edgesOutOf("/repo/api/x.ts")).toHaveLength(1);
  });

  it("edgesInto() returns a named module's edges regardless of scope", () => {
    expect(
      scoped()
        .edgesInto("/repo/web/a.ts")
        .map((e) => e.from),
    ).toEqual(["/repo/api/y.ts"]);
  });

  it("reachableFrom() traverses out of the scope", () => {
    expect([...scoped().reachableFrom("/repo/web/a.ts")].sort()).toEqual([
      "/repo/api/x.ts",
      "/repo/api/y.ts",
      "/repo/web/a.ts",
      "/repo/web/b.ts",
    ]);
  });

  it("reaching() traverses out of the scope", () => {
    expect([...scoped().reaching("/repo/web/a.ts")].sort()).toEqual([
      "/repo/api/x.ts",
      "/repo/api/y.ts",
      "/repo/web/a.ts",
    ]);
  });

  it("pathBetween() finds a path that leaves the scope", () => {
    expect(scoped().pathBetween("/repo/web/a.ts", "/repo/api/y.ts")).toEqual([
      "/repo/web/a.ts",
      "/repo/api/x.ts",
      "/repo/api/y.ts",
    ]);
  });
});

describe("a selection's edges are anchored, not filtered", () => {
  it("edgesOut() takes every edge leaving a selected module", () => {
    const q = scoped();
    const sel = q.modules({ tag: { area: "web" } });
    expect(
      sel
        .edgesOut()
        .map((e) => e.to)
        .sort(),
    ).toEqual(["/repo/api/x.ts", "/repo/web/b.ts"]);
  });

  it("edgesIn() takes every edge arriving at a selected module, including from outside", () => {
    const q = scoped();
    const sel = q.modules({ tag: { area: "web" } });
    expect(sel.edgesIn().map((e) => e.from)).toContain("/repo/api/y.ts");
  });
});

describe("computations are scoped, like every other enumeration", () => {
  /** Enumerates the graph it is given, so it reveals which view it actually received. */
  const seenModules = defineGraphComputation<string[]>({
    name: "seen-modules",
    compute: (q) => [...q.moduleIds()].sort(),
  });

  const reportComputed = defineRule({
    meta: { name: "report-computed", description: "", defaultSeverity: "error" },
    check(ctx) {
      for (const id of ctx.compute(seenModules)) ctx.report({ module: id, message: id });
    },
  });

  it("a scoped rule's compute() sees only its own slice", async () => {
    // The bug this fixes: `ctx.graph` was narrowed and `ctx.compute` silently was not, so a
    // `no-cycles` scoped to one app reported cycles from another.
    const result = await analyze(
      graph(),
      resolveConfig(
        {
          rules: [configureRule(reportComputed, {}, { scope: { include: ["web/**"] } })],
        },
        { cwd: "/repo" },
      ),
    );
    expect(result.violations.map((v) => primaryModule(v)).sort()).toEqual([
      "/repo/web/a.ts",
      "/repo/web/b.ts",
    ]);
  });

  it("an unscoped rule's compute() still sees everything", async () => {
    const result = await analyze(
      graph(),
      resolveConfig({ rules: [configureRule(reportComputed)] }, { cwd: "/repo" }),
    );
    expect(result.violations).toHaveLength(4);
  });
});
