import * as path from "node:path";
import { check } from "@archwall/cli";
import type { Preset, Reporter, UserConfig, Violation } from "@archwall/core";
import archwallEsbuild from "@archwall/esbuild";
import { primaryEdge, primaryModule } from "@archwall/integration-kit";
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
 * Violations reduced to (rule, from, to) over CANONICAL module ids.
 *
 * There used to be a normalisation step here — collapsing an external to its package name so
 * that a host resolving `react` into node_modules compared equal to one leaving the bare
 * specifier, with a documented guard for each branch. Two copies of that helper existed, this
 * one and `rel()` in the conformance harness, which is what said identity did not belong to the
 * producers. Both are gone: the suite now compares what the IR actually says, and parity holding
 * on raw ids is the proof that it is real.
 */
function normalize(vs: readonly Violation[]): string[] {
  return vs
    .map((v) => {
      const edge = primaryEdge(v);
      return [v.ruleId, edge ? edge.from : (primaryModule(v) ?? ""), edge ? edge.to : ""].join("|");
    })
    .sort();
}

/** Every violation carries its own fingerprint; this is what a baseline file would key on. */
function fingerprints(vs: readonly Violation[]): string[] {
  return vs.map((v) => `${v.ruleId}|${v.fingerprint}`).sort();
}

/** How a producer's violations are reduced for comparison. */
type Projection = (vs: readonly Violation[]) => string[];

/** Runs one producer with a collecting reporter and returns its violations, comparably. */
async function collectFrom(
  produce: (collector: Reporter) => Promise<unknown>,
  project: Projection,
): Promise<string[]> {
  const collected: Violation[] = [];
  await produce({
    name: "collect",
    onRunEnd: (r) => {
      collected.push(...r.violations);
    },
  });
  return project(collected);
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
  project: Projection = normalize,
): Promise<Record<Producer, string[]>> {
  const { dir, src } = fixture(name);
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
    project,
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
    project,
  );
  const esbuild = await collectFrom(
    (collector) =>
      buildWithEsbuild(archwallEsbuild({ config: { ...sharedConfig, reporters: [collector] } }), {
        where: { dir, src },
      }),
    project,
  );
  const rspack = await collectFrom(
    (collector) =>
      buildWithRspack(
        new ArchWallPlugin({
          config: { ...sharedConfig, reporters: [collector] },
        }),
        { dir, src },
      ),
    project,
  );
  const webpack = await collectFrom(
    (collector) =>
      buildWithWebpack(
        new ArchWallPlugin({
          config: { ...sharedConfig, reporters: [collector] },
        }),
        { dir, src },
      ),
    project,
  );
  const cli = project((await check({ cwd: dir, config: sharedConfig })).result.violations);
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
    expect(dropped).toEqual([
      "fsd/layer-dependencies|file:src/shared/lib/bad.ts|file:src/widgets/header/index.ts",
    ]);
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

/**
 * The promise a baseline file will be built on: the same architecture problem, found by two
 * different bundlers, has the same identity.
 *
 * This is the case that used to be false. `layered-app`'s purity violation is about `react`,
 * which the CLI resolves to a path under node_modules and esbuild leaves as a bare specifier —
 * so the fingerprint, which hashes the offending locations, differed by host. The parity suite
 * above could not see it, because it compared violations only after normalising exactly that
 * difference away.
 */
describe("fingerprint stability across producers", () => {
  for (const { name, preset } of CASES) {
    it(`assigns identical fingerprints under every producer for ${name}`, async () => {
      const all = await allProducers(
        name,
        { sourceRoot: "src", presets: [preset], failOn: "never", reporters: [] },
        fingerprints,
      );
      expect(all.vite.length).toBeGreaterThan(0);
      for (const host of OTHERS) expect(all[host], host).toEqual(all.vite);
    }, 240_000);
  }

  it("includes a violation about a third-party package, which is the case that used to differ", async () => {
    const preset = layered({
      layers: ["presentation", "infrastructure", "application", "domain"],
      pure: ["domain"],
    });
    const all = await allProducers("layered-app", {
      sourceRoot: "src",
      presets: [preset],
      failOn: "never",
      reporters: [],
    });
    expect(all.vite).toContain("layered/purity-domain|file:src/domain/rules.ts|pkg:react");
  }, 240_000);
});
