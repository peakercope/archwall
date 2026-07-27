import * as path from "node:path";
import { check } from "@archwall/cli";
import type { Preset, Reporter, UserConfig, Violation } from "@archwall/core";
import { packageNameFromPath } from "@archwall/integration-kit";
import { fsd, layered, modules } from "@archwall/presets";
import ArchWallPlugin from "@archwall/rspack";
import archwallVite from "@archwall/vite";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { buildWithRspack, buildWithWebpack, fixture } from "../../rspack/test/bundlers.js";

/** Externals differ by path between hosts but never by package identity. */
function normalize(srcRoot: string) {
  const at = (p: string) =>
    packageNameFromPath(p) ?? path.relative(srcRoot, p).replaceAll("\\", "/");
  return (vs: readonly Violation[]) =>
    vs
      .map((v) =>
        [v.ruleId, v.edge ? at(v.edge.from) : (v.module ?? ""), v.edge ? at(v.edge.to) : ""].join(
          "|",
        ),
      )
      .sort();
}

/** Runs one producer with a collecting reporter and returns its normalized violations. */
async function collectFrom(
  produce: (collector: Reporter) => Promise<unknown>,
  norm: (vs: readonly Violation[]) => string[],
): Promise<string[]> {
  const collected: Violation[] = [];
  await produce({
    name: "collect",
    onRunEnd: (r) => {
      collected.push(...r.violations);
    },
  });
  return norm(collected);
}

const CASES: { name: string; preset: Preset }[] = [
  { name: "fsd-app", preset: fsd() },
  {
    name: "layered-app",
    preset: layered({
      layers: ["presentation", "infrastructure", "application", "domain"],
      pure: ["domain"],
    }),
  },
  {
    name: "modules-app",
    preset: modules({
      root: "modules",
      shared: ["shared"],
      depends: { billing: ["identity"] },
    }),
  },
];

/** Runs one config through all four graph producers and returns their normalized results. */
async function allProducers(
  name: string,
  sharedConfig: UserConfig,
): Promise<{
  vite: string[];
  rspack: string[];
  webpack: string[];
  cli: string[];
}> {
  const { dir, src } = fixture(name);
  const norm = normalize(src);
  const vite = await collectFrom(
    (collector) =>
      build({
        root: dir,
        logLevel: "silent",
        configFile: false,
        plugins: [archwallVite({ config: { ...sharedConfig, reporters: [collector] } })],
        resolve: { alias: { "@": src } },
        build: {
          write: false,
          rollupOptions: { input: path.join(src, "main.ts") },
        },
      }),
    norm,
  );
  const rspack = await collectFrom(
    (collector) =>
      buildWithRspack(
        new ArchWallPlugin({
          config: { ...sharedConfig, reporters: [collector] },
        }),
        { dir, src },
      ),
    norm,
  );
  const webpack = await collectFrom(
    (collector) =>
      buildWithWebpack(
        new ArchWallPlugin({
          config: { ...sharedConfig, reporters: [collector] },
        }),
        { dir, src },
      ),
    norm,
  );
  const cli = norm((await check({ cwd: dir, config: sharedConfig })).result.violations);
  return { vite, rspack, webpack, cli };
}

describe("shared-core promise", () => {
  for (const { name, preset } of CASES) {
    it(`every graph producer reports identical violations for ${name}`, async () => {
      const { vite, rspack, webpack, cli } = await allProducers(name, {
        sourceRoot: "src",
        presets: [preset],
        failOn: "never",
        reporters: [],
      });
      expect(vite.length).toBeGreaterThan(0);
      expect(rspack).toEqual(vite);
      expect(webpack).toEqual(vite);
      expect(cli).toEqual(vite);
    }, 120_000);
  }

  /**
   * The regression test for the defect this suite used to miss entirely.
   *
   * `include`/`exclude` were read by exactly one producer — the CLI's filesystem walk —
   * and silently ignored by every bundler adapter. Excluding a bundled file therefore
   * dropped its violations under the CLI and kept them under Vite, Rspack, and webpack.
   * The suite passed only because no case ever set either field.
   *
   * `shared/lib/bad.ts` is the source of fsd-app's `layer-dependencies` violation, so
   * excluding it must remove exactly that violation — from all four producers.
   */
  it("honors `exclude` identically across every producer", async () => {
    const base: UserConfig = {
      sourceRoot: "src",
      presets: [fsd()],
      failOn: "never",
      reporters: [],
    };
    const before = await allProducers("fsd-app", base);
    const after = await allProducers("fsd-app", {
      ...base,
      exclude: ["shared/lib/bad.ts"],
    });

    expect(after.rspack).toEqual(after.vite);
    expect(after.webpack).toEqual(after.vite);
    expect(after.cli).toEqual(after.vite);

    const dropped = before.vite.filter((v) => !after.vite.includes(v));
    expect(dropped).toEqual(["fsd/layer-dependencies|shared/lib/bad.ts|widgets/header/index.ts"]);
  }, 240_000);

  it("honors a narrowed `include` identically across every producer", async () => {
    const { vite, rspack, webpack, cli } = await allProducers("fsd-app", {
      sourceRoot: "src",
      presets: [fsd()],
      failOn: "never",
      reporters: [],
      // Only the features layer is part of the project; violations anchored outside it
      // must disappear everywhere, not just under the CLI.
      include: ["features/**"],
    });
    expect(rspack).toEqual(vite);
    expect(webpack).toEqual(vite);
    expect(cli).toEqual(vite);
    expect(vite.some((v) => v.includes("shared/lib/bad.ts"))).toBe(false);
  }, 240_000);
});
