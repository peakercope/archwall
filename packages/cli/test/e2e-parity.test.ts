import * as path from "node:path";
import { check } from "@archwall/cli";
import type { Preset, Reporter, UserConfig, Violation } from "@archwall/core";
import archwallEsbuild from "@archwall/esbuild";
import { packageNameFromPath, primaryEdge, primaryModule } from "@archwall/integration-kit";
import { fsd, layered, modules } from "@archwall/presets";
import archwallRollup from "@archwall/rollup";
import ArchWallPlugin from "@archwall/rspack";
import archwallVite from "@archwall/vite";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { buildWithEsbuild } from "../../esbuild/test/builds.js";
import { buildWithRollup } from "../../rollup/test/builds.js";
import { buildWithRspack, buildWithWebpack, fixture } from "../../rspack/test/bundlers.js";

/**
 * Externals differ by path between hosts but never by package identity.
 *
 * The `isAbsolute` guard matters: a host that leaves an external unresolved reports the
 * bare specifier (`react`), and `path.relative` would resolve that against `process.cwd()`
 * and turn it into `../../../../../react`. Only the hosts that resolve externals into
 * node_modules were compared before, so nothing ever exercised the other branch. This
 * mirrors `rel()` in `@archwall/integration-kit`'s conformance helpers.
 */
function normalize(srcRoot: string) {
  const at = (p: string) => {
    const pkg = packageNameFromPath(p);
    if (pkg !== undefined) return pkg;
    const normalized = p.replaceAll("\\", "/");
    return path.isAbsolute(normalized)
      ? path.relative(srcRoot, normalized).replaceAll("\\", "/")
      : normalized;
  };
  return (vs: readonly Violation[]) =>
    vs
      .map((v) => {
        const edge = primaryEdge(v);
        return [
          v.ruleId,
          edge ? at(edge.from) : (primaryModule(v) ?? ""),
          edge ? at(edge.to) : "",
        ].join("|");
      })
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

type Producer = "vite" | "rollup" | "esbuild" | "rspack" | "webpack" | "cli";

/** Runs one config through every graph producer and returns their normalized results. */
async function allProducers(
  name: string,
  sharedConfig: UserConfig,
): Promise<Record<Producer, string[]>> {
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
  const rollup = await collectFrom(
    (collector) =>
      buildWithRollup(
        archwallRollup({
          config: { ...sharedConfig, reporters: [collector] },
          cwd: () => dir,
        }),
        { where: { dir, src } },
      ),
    norm,
  );
  const esbuild = await collectFrom(
    (collector) =>
      buildWithEsbuild(archwallEsbuild({ config: { ...sharedConfig, reporters: [collector] } }), {
        where: { dir, src },
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
  return { vite, rollup, esbuild, rspack, webpack, cli };
}

/** Vite is the reference producer; every other must agree with it exactly. */
const OTHERS = [
  "rollup",
  "esbuild",
  "rspack",
  "webpack",
  "cli",
] as const satisfies readonly Exclude<Producer, "vite">[];

describe("shared-core promise", () => {
  for (const { name, preset } of CASES) {
    it(`every graph producer reports identical violations for ${name}`, async () => {
      const all = await allProducers(name, {
        sourceRoot: "src",
        presets: [preset],
        failOn: "never",
        reporters: [],
      });
      expect(all.vite.length).toBeGreaterThan(0);
      for (const host of OTHERS) expect(all[host], host).toEqual(all.vite);
    }, 240_000);
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
   * excluding it must remove exactly that violation — from every producer.
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

    for (const host of OTHERS) expect(after[host], host).toEqual(after.vite);

    const dropped = before.vite.filter((v) => !after.vite.includes(v));
    expect(dropped).toEqual(["fsd/layer-dependencies|shared/lib/bad.ts|widgets/header/index.ts"]);
  }, 480_000);

  it("honors a narrowed `include` identically across every producer", async () => {
    const all = await allProducers("fsd-app", {
      sourceRoot: "src",
      presets: [fsd()],
      failOn: "never",
      reporters: [],
      // Only the features layer is part of the project; violations anchored outside it
      // must disappear everywhere, not just under the CLI.
      include: ["features/**"],
    });
    for (const host of OTHERS) expect(all[host], host).toEqual(all.vite);
    expect(all.vite.some((v) => v.includes("shared/lib/bad.ts"))).toBe(false);
  }, 360_000);
});
