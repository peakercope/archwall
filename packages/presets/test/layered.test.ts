import type { Preset, ProjectGraph, Violation } from "@archwall/core";
import { analyze, resolveConfig } from "@archwall/core";
import { layered, layeredClassifier } from "@archwall/presets";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

const ROOT = "/proj";
const f = (p: string) => `${ROOT}/src/${p}`;

async function run(preset: Preset, graph: ProjectGraph): Promise<readonly Violation[]> {
  const config = resolveConfig({ presets: [preset] }, { cwd: ROOT });
  return (await analyze(graph, config)).violations;
}

const LAYERS = ["presentation", "application", "domain"];
const opts = { root: "src", layers: LAYERS };

describe("layered classifier", () => {
  it("tags a layer from a directory name", () => {
    const c = layeredClassifier(opts);
    expect(
      c.classify({ file: f("domain/user.ts"), kind: "source" } as never, {
        sourceRoot: ROOT,
      }),
    ).toEqual({
      layer: "domain",
    });
  });

  it("supports the map form for nested trees", () => {
    const c = layeredClassifier({
      root: "src",
      layers: { infrastructure: "infrastructure", domain: "core/domain" },
    });
    const tag = (p: string) =>
      c.classify({ file: f(p), kind: "source" } as never, { sourceRoot: ROOT });
    expect(tag("core/domain/user.ts")).toMatchObject({ layer: "domain" });
    expect(tag("infrastructure/db.ts")).toMatchObject({
      layer: "infrastructure",
    });
    expect(tag("core/other/x.ts")).toBeNull();
  });
});

describe("layered preset", () => {
  it("allows downward and same-layer imports, reports upward", async () => {
    const g = buildFixtureGraph({
      modules: [
        f("presentation/http.ts"),
        f("application/create-user.ts"),
        f("application/audit.ts"),
        f("domain/user.ts"),
        f("domain/rules.ts"),
      ],
      edges: [
        [f("presentation/http.ts"), f("application/create-user.ts")],
        [f("application/create-user.ts"), f("domain/user.ts")],
        [f("domain/user.ts"), f("domain/rules.ts")], // ok: same layer
        [f("domain/rules.ts"), f("application/audit.ts")], // VIOLATION: upward
      ],
    });
    const v = await run(layered(opts), g);
    expect(v.map((x) => x.ruleId)).toEqual(["layered/layer-dependencies"]);
  });

  it("adds no purity rule unless asked", async () => {
    const config = resolveConfig({ presets: [layered(opts)] }, { cwd: ROOT });
    expect(config.rules.map((r) => r.id).sort()).toEqual([
      "layered/layer-dependencies",
      "layered/no-cycles",
    ]);
  });

  it("forbids third-party imports from a pure layer", async () => {
    const g = buildFixtureGraph({
      modules: [
        f("domain/user.ts"),
        f("application/x.ts"),
        { id: "axios", kind: "package", packageName: "axios" },
        { id: "zod", kind: "package", packageName: "zod" },
      ],
      edges: [
        [f("domain/user.ts"), "axios"], // VIOLATION
        [f("domain/user.ts"), "zod"], // allowed by allowExternals
        [f("application/x.ts"), "axios"], // application is not pure
      ],
    });
    const v = await run(layered({ ...opts, pure: ["domain"], allowExternals: ["zod"] }), g);
    expect(v.map((x) => x.ruleId)).toEqual(["layered/purity-domain"]);
    expect(v[0]!.edge?.to).toBe("axios");
    expect(v[0]!.message).toContain("domain");
  });

  it("gives each pure layer its own overridable rule id", () => {
    const config = resolveConfig(
      { presets: [layered({ ...opts, pure: ["domain", "application"] })] },
      { cwd: ROOT },
    );
    expect(config.rules.map((r) => r.id)).toContain("layered/purity-domain");
    expect(config.rules.map((r) => r.id)).toContain("layered/purity-application");
  });

  it("isolates siblings inside the named layers only", async () => {
    const g = buildFixtureGraph({
      modules: [
        f("adapters/http/server.ts"),
        f("adapters/db/repo.ts"),
        f("domain/a/x.ts"),
        f("domain/b/y.ts"),
      ],
      edges: [
        [f("adapters/http/server.ts"), f("adapters/db/repo.ts")], // VIOLATION: adapters are isolated
        [f("domain/a/x.ts"), f("domain/b/y.ts")], // domain is not isolated
      ],
    });
    const v = await run(
      layered({
        root: "src",
        layers: ["adapters", "domain"],
        isolate: ["adapters"],
      }),
      g,
    );
    expect(v.map((x) => x.ruleId)).toEqual(["layered/feature-isolation"]);
  });

  it("strict mode reports files in no layer", async () => {
    const g = buildFixtureGraph({
      modules: [f("domain/user.ts"), f("junk/stray.ts")],
    });
    const v = await run(layered({ ...opts, strict: true }), g);
    expect(v.map((x) => x.ruleId)).toEqual(["layered/require-tag"]);
    expect(v[0]!.message).toContain("junk/stray.ts");
  });
});
