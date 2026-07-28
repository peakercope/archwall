import * as path from "node:path";
import { check } from "@archwall/cli";
import type { ConfiguredRule, UserConfig } from "@archwall/core";
import { configureRule, defineRule } from "@archwall/core";
import archwallEsbuild from "@archwall/esbuild";
import type { GraphSnapshot } from "@archwall/integration-kit";
import { assertGraphsMatch, graphSnapshot } from "@archwall/integration-kit";
import archwallRollup from "@archwall/rollup";
import ArchWallPlugin from "@archwall/rspack";
import archwallVite from "@archwall/vite";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { buildWithEsbuild } from "../../esbuild/test/builds.js";
import { buildWithRollup } from "../../rollup/test/builds.js";
import { buildWithRspack, buildWithWebpack } from "../../rspack/test/bundlers.js";

/**
 * Conformance over the IR ITSELF, not just over the violations it produces.
 *
 * The suite compared `{ruleName, from, to}` and nothing else, so a third-party adapter
 * could certify as conformant while mislabelling every dynamic import as static or every
 * builtin as a package — neither of which changes a violation in the three original
 * fixtures, and both of which break purity and cycle rules for everyone else.
 *
 * The fixture exercises the four graph shapes the suite never covered at all: a tsconfig
 * path alias, a barrel, a dynamic import, and a runtime builtin.
 */
const FIXTURE = path.resolve(import.meta.dirname, "../../integration-kit/fixtures/graph-shapes");
const SRC = path.join(FIXTURE, "src");

/** Captures the graph a producer built, via the public rule API. */
function snapshotProbe(
  sink: { snapshot?: GraphSnapshot },
  edgeKinds: "exact" | "coarse" = "coarse",
): ConfiguredRule<Record<string, never>> {
  return configureRule(
    defineRule<Record<string, never>>({
      meta: {
        name: "snapshot",
        description: "Captures the graph.",
        defaultSeverity: "warn",
      },
      check(ctx) {
        // Straight from the query a rule already has — no reconstruction of the graph, and
        // therefore no hand-written copy of the representation the IR keeps private.
        sink.snapshot = graphSnapshot(ctx.graph, SRC, { edgeKinds });
      },
    }),
  );
}

function configWith(rule: ConfiguredRule<Record<string, never>>): UserConfig {
  return { sourceRoot: "src", rules: [rule], failOn: "never", reporters: [] };
}

type Producer = "vite" | "rollup" | "esbuild" | "rspack" | "webpack" | "cli";

async function graphs(): Promise<Record<Producer, GraphSnapshot>> {
  const out = {} as Record<Producer, GraphSnapshot>;

  const vite: { snapshot?: GraphSnapshot } = {};
  await build({
    root: FIXTURE,
    logLevel: "silent",
    configFile: false,
    plugins: [archwallVite({ config: configWith(snapshotProbe(vite)) })],
    resolve: { alias: { "@": SRC } },
    build: {
      write: false,
      rollupOptions: {
        input: path.join(SRC, "main.ts"),
        external: ["node:path"],
      },
    },
  });
  out.vite = vite.snapshot!;

  const rollup: { snapshot?: GraphSnapshot } = {};
  await buildWithRollup(
    archwallRollup({ config: configWith(snapshotProbe(rollup)), cwd: () => FIXTURE }),
    { where: { dir: FIXTURE, src: SRC } },
  );
  out.rollup = rollup.snapshot!;

  const esbuild: { snapshot?: GraphSnapshot } = {};
  await buildWithEsbuild(archwallEsbuild({ config: configWith(snapshotProbe(esbuild)) }), {
    where: { dir: FIXTURE, src: SRC },
  });
  out.esbuild = esbuild.snapshot!;

  const rspack: { snapshot?: GraphSnapshot } = {};
  await buildWithRspack(new ArchWallPlugin({ config: configWith(snapshotProbe(rspack)) }), {
    dir: FIXTURE,
    src: SRC,
  });
  out.rspack = rspack.snapshot!;

  const webpack: { snapshot?: GraphSnapshot } = {};
  await buildWithWebpack(new ArchWallPlugin({ config: configWith(snapshotProbe(webpack)) }), {
    dir: FIXTURE,
    src: SRC,
  });
  out.webpack = webpack.snapshot!;

  const cli: { snapshot?: GraphSnapshot } = {};
  await check({ cwd: FIXTURE, config: configWith(snapshotProbe(cli)) });
  out.cli = cli.snapshot!;

  return out;
}

describe("IR conformance across producers", () => {
  it("builds the same normalized graph under every producer", async () => {
    const all = await graphs();
    const { vite } = all;

    // Every first-party file must be present and `source` under all six.
    for (const [host, snap] of Object.entries(all)) {
      for (const file of [
        "main.ts",
        "feature/index.ts",
        "feature/lazy.ts",
        "shared/index.ts",
        "shared/util.ts",
      ]) {
        expect(snap.modules[file], `${host} is missing ${file}`).toBe("source");
      }
      // A runtime builtin must never be labelled a third-party package: that distinction
      // is what makes a purity rule correct about `node:crypto` versus `lodash`.
      expect(snap.modules["node:path"], `${host} mislabelled node:path`).toBe("builtin");
    }

    for (const host of ["rollup", "esbuild", "rspack", "webpack", "cli"] as const) {
      assertGraphsMatch(all[host], vite, `${host} vs vite`);
    }
  }, 360_000);

  it("resolves an alias through a barrel to the real file, on every producer", async () => {
    // `main.ts` imports "@/feature" (tsconfig path alias); `feature/index.ts` imports
    // "@/shared", which is a BARREL over `util.ts`. Source-text analysis cannot see
    // through either — this is the case that motivates analysing the compiled graph.
    const all = await graphs();
    for (const [host, snap] of Object.entries(all)) {
      expect(snap.edges, `${host}`).toContain("main.ts -> feature/index.ts (static)");
      expect(snap.edges, `${host}`).toContain("feature/index.ts -> shared/index.ts (static)");
      // Coarse edge kind: `reexport-edges` is a declared capability and Vite/Rollup and
      // esbuild genuinely cannot distinguish a re-export, so the barrel edge is compared
      // as `static` rather than failing an adapter for honestly declaring its limits.
      expect(snap.edges, `${host}`).toContain("shared/index.ts -> shared/util.ts (static)");
    }
  }, 360_000);

  it("marks a dynamic import dynamic, on every producer", async () => {
    // Mislabelling this as static changes results: `no-cycles` treats a dynamic edge as a
    // legal cycle-breaker, so the same code would report a cycle under one host and not
    // another. `dynamic` is never coarsened, precisely because it is not capability-gated.
    const all = await graphs();
    for (const [host, snap] of Object.entries(all)) {
      expect(snap.edges, `${host}`).toContain("feature/index.ts -> feature/lazy.ts (dynamic)");
    }
  }, 360_000);

  it("distinguishes a re-export where the host declares `reexport-edges`", async () => {
    // The coarse comparison above must not hide the fact that capable hosts DO report it.
    const cli: { snapshot?: GraphSnapshot } = {};
    await check({
      cwd: FIXTURE,
      config: configWith(snapshotProbe(cli, "exact")),
    });
    expect(cli.snapshot!.edges).toContain("shared/index.ts -> shared/util.ts (reexport)");
  }, 120_000);
});
