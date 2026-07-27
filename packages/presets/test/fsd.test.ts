import type { Violation } from "@archwall/core";
import { analyze, resolveConfig } from "@archwall/core";
import { FSD_LAYERS, fsd, fsdClassifier } from "@archwall/presets";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

const ROOT = "/proj";
const f = (p: string) => `${ROOT}/src/${p}`;

async function run(preset: ReturnType<typeof fsd>, graph = APP): Promise<readonly Violation[]> {
  const config = resolveConfig({ presets: [preset] }, { cwd: ROOT });
  return (await analyze(graph, config)).violations;
}

const APP = buildFixtureGraph({
  modules: [
    f("app/main.ts"),
    f("features/auth/index.ts"),
    f("features/auth/model/store.ts"),
    f("features/cart/index.ts"),
    f("features/cart/model/cart.ts"),
    f("features/cart/@x/auth.ts"),
    f("entities/user/index.ts"),
    f("shared/lib/format.ts"),
  ],
  edges: [
    [f("app/main.ts"), f("features/cart/index.ts")], // ok: app → features, via public API
    [f("features/auth/model/store.ts"), f("entities/user/index.ts")], // ok: down a layer
    [f("features/auth/model/store.ts"), f("shared/lib/format.ts")], // ok: shared has no public API
    [f("features/cart/index.ts"), f("features/cart/model/cart.ts")], // ok: inside one slice
  ],
});

describe("fsd classifier", () => {
  const c = fsdClassifier({ src: "src" });
  const tag = (p: string) =>
    c.classify({ file: f(p), kind: "source" } as never, { sourceRoot: ROOT });

  it("tags layer, slice, segment and visibility", () => {
    expect(tag("features/auth/index.ts")).toEqual({
      layer: "features",
      slice: "auth",
      visibility: "public",
    });
    expect(tag("features/auth/model/store.ts")).toEqual({
      layer: "features",
      slice: "auth",
      segment: "model",
      visibility: "internal",
    });
  });

  it("treats @x cross-import files as public API", () => {
    expect(tag("features/cart/@x/auth.ts")).toMatchObject({
      visibility: "public",
    });
  });

  it("does not slice app or shared", () => {
    expect(tag("app/main.ts")).toEqual({ layer: "app" });
    expect(tag("shared/lib/format.ts")).toEqual({ layer: "shared" });
  });
});

describe("fsd preset", () => {
  it("passes a well-formed app", async () => {
    expect(await run(fsd({ src: "src" }))).toEqual([]);
  });

  it("names its rules under the preset", async () => {
    const config = resolveConfig({ presets: [fsd({ src: "src" })] }, { cwd: ROOT });
    expect(config.rules.map((r) => r.id).sort()).toEqual([
      "fsd/feature-isolation",
      "fsd/layer-dependencies",
      "fsd/no-cycles",
      "fsd/public-api",
    ]);
  });

  it("reports an upward layer import", async () => {
    const g = buildFixtureGraph({
      modules: [f("shared/lib/bad.ts"), f("features/auth/index.ts")],
      edges: [[f("shared/lib/bad.ts"), f("features/auth/index.ts")]],
    });
    const v = await run(fsd({ src: "src" }), g);
    expect(v.map((x) => x.ruleId)).toEqual(["fsd/layer-dependencies"]);
  });

  it("reports a deep cross-slice import exactly once per rule", async () => {
    const g = buildFixtureGraph({
      modules: [f("features/cart/model/cart.ts"), f("features/auth/model/store.ts")],
      edges: [[f("features/cart/model/cart.ts"), f("features/auth/model/store.ts")]],
    });
    const v = await run(fsd({ src: "src" }), g);
    // Isolation (wrong slice) and public-api (internal target) are distinct faults.
    expect(v.map((x) => x.ruleId).sort()).toEqual(["fsd/feature-isolation", "fsd/public-api"]);
  });

  it("swaps isolation for the cross-import matrix, never running both", async () => {
    const g = buildFixtureGraph({
      modules: [f("features/cart/index.ts"), f("features/auth/index.ts")],
      edges: [[f("features/cart/index.ts"), f("features/auth/index.ts")]],
    });
    expect(await run(fsd({ src: "src", crossImports: { cart: ["auth"] } }), g)).toEqual([]);

    const denied = await run(fsd({ src: "src", crossImports: { cart: [] } }), g);
    expect(denied.map((x) => x.ruleId)).toEqual(["fsd/friend-modules"]);
  });

  it("strict mode reports files in no layer", async () => {
    const g = buildFixtureGraph({
      modules: [f("vendor/hack.ts"), f("shared/lib/format.ts")],
    });
    const v = await run(fsd({ src: "src", strict: true }), g);
    expect(v.map((x) => x.ruleId)).toEqual(["fsd/require-tag"]);
    expect(v[0]!.message).toContain("vendor/hack.ts");
  });

  it("exposes the canonical layer order", () => {
    expect([...FSD_LAYERS]).toEqual(["app", "pages", "widgets", "features", "entities", "shared"]);
  });
});
