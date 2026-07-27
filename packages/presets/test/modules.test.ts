import type { Preset, ProjectGraph, Violation } from "@archwall/core";
import { analyze, resolveConfig } from "@archwall/core";
import { modules, modulesClassifier } from "@archwall/presets";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

const ROOT = "/proj";
const f = (p: string) => `${ROOT}/src/modules/${p}`;
const app = `${ROOT}/src/main.ts`;

async function run(preset: Preset, graph: ProjectGraph): Promise<readonly Violation[]> {
  const config = resolveConfig({ presets: [preset] }, { cwd: ROOT });
  return (await analyze(graph, config)).violations;
}

const opts = { root: "src/modules" };

describe("modules classifier", () => {
  const c = modulesClassifier(opts);
  const tag = (p: string) => c.classify({ file: p, kind: "source" } as never, { sourceRoot: ROOT });

  it("tags each top-level directory as a module and marks its index public", () => {
    expect(tag(f("billing/index.ts"))).toEqual({
      module: "billing",
      visibility: "public",
    });
    expect(tag(f("billing/model/invoice.ts"))).toEqual({
      module: "billing",
      visibility: "internal",
    });
  });

  it("leaves the app shell outside the module tree untagged", () => {
    expect(tag(app)).toBeNull();
  });
});

describe("modules preset", () => {
  it("forbids every cross-module import by default", async () => {
    const g = buildFixtureGraph({
      modules: [f("billing/index.ts"), f("identity/index.ts")],
      edges: [[f("billing/index.ts"), f("identity/index.ts")]],
    });
    const v = await run(modules(opts), g);
    expect(v.map((x) => x.ruleId)).toEqual(["modules/friend-modules"]);
  });

  it("allows exactly what the dependency matrix declares", async () => {
    const g = buildFixtureGraph({
      modules: [f("billing/index.ts"), f("identity/index.ts"), f("reporting/index.ts")],
      edges: [
        [f("billing/index.ts"), f("identity/index.ts")], // declared
        [f("identity/index.ts"), f("reporting/index.ts")], // VIOLATION: not declared
      ],
    });
    const v = await run(modules({ ...opts, depends: { billing: ["identity"] } }), g);
    expect(v.map((x) => x.ruleId)).toEqual(["modules/friend-modules"]);
    expect(v[0]!.edge?.from).toBe(f("identity/index.ts"));
  });

  it("lets every module reach `shared` without declaring it", async () => {
    const g = buildFixtureGraph({
      modules: [f("billing/index.ts"), f("shared/index.ts")],
      edges: [[f("billing/index.ts"), f("shared/index.ts")]],
    });
    expect(await run(modules({ ...opts, shared: ["shared"] }), g)).toEqual([]);
  });

  it("blocks deep imports past a module's public API, including from the app shell", async () => {
    const g = buildFixtureGraph({
      modules: [app, f("billing/index.ts"), f("billing/model/invoice.ts")],
      edges: [
        [app, f("billing/index.ts")], // ok: through the public API
        [app, f("billing/model/invoice.ts")], // VIOLATION: reaches inside
        [f("billing/index.ts"), f("billing/model/invoice.ts")], // ok: same module
      ],
    });
    const v = await run(modules(opts), g);
    expect(v.map((x) => x.ruleId)).toEqual(["modules/public-api"]);
    expect(v[0]!.edge?.to).toBe(f("billing/model/invoice.ts"));
  });

  it("reports a forbidden deep cross-module import once per distinct fault", async () => {
    const g = buildFixtureGraph({
      modules: [f("billing/model/a.ts"), f("identity/model/b.ts")],
      edges: [[f("billing/model/a.ts"), f("identity/model/b.ts")]],
    });
    const v = await run(modules(opts), g);
    expect(v.map((x) => x.ruleId).sort()).toEqual(["modules/friend-modules", "modules/public-api"]);
  });

  it("can drop public API enforcement", async () => {
    const config = resolveConfig(
      { presets: [modules({ ...opts, publicApi: false })] },
      { cwd: ROOT },
    );
    expect(config.rules.map((r) => r.id)).not.toContain("modules/public-api");
  });

  it("strict mode reports loose files in the module root", async () => {
    const g = buildFixtureGraph({
      modules: [f("billing/index.ts"), `${ROOT}/src/modules/stray.ts`],
    });
    const v = await run(modules({ ...opts, strict: true }), g);
    expect(v.map((x) => x.ruleId)).toEqual(["modules/require-tag"]);
  });
});
