import * as path from "node:path";
import { check } from "@archwall/cli";
import type { ConfiguredRule, ModuleKind, UserConfig, Violation } from "@archwall/core";
import { configureRule, defineRule } from "@archwall/core";
import ArchWallPlugin from "@archwall/rspack";
import archwallVite from "@archwall/vite";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { buildWithRspack, buildWithWebpack } from "../../rspack/test/bundlers.js";

/**
 * Monorepo conformance fixture.
 *
 * Every other conformance fixture is a single package, which is why the suite never
 * exercised `ModuleKind: "workspace"` — the kind that exists specifically to distinguish
 * "first-party code owned by a sibling package" from "third-party dependency". Module-kind
 * inference used to be implemented independently three times (`vite/src/index.ts` `kindOf`,
 * `rspack/src/extract.ts` `kindOf`, and inline in `cli/src/scan.ts`), and nothing forced the
 * three to agree; they now share `createModuleKindResolver` and this fixture is what holds
 * them to it.
 *
 * `packages/app/src/main.ts` imports `packages/lib/src/index.ts`; `sourceRoot` is the app's
 * src, so the target is first-party code owned by a different package.
 */
const FIXTURE = path.resolve(import.meta.dirname, "../../integration-kit/fixtures/monorepo-app");
const APP_SRC = path.join(FIXTURE, "packages/app/src");
const SIBLING = "packages/lib/src/index.ts";

const rel = (p: string): string => path.relative(FIXTURE, p).replaceAll("\\", "/");

/** Records the kind each producer assigned to every module. Public rule API only. */
function kindProbe(sink: Map<string, ModuleKind>): ConfiguredRule<Record<string, never>> {
  return configureRule(
    defineRule<Record<string, never>>({
      meta: {
        name: "kind-probe",
        description: "Records the kind of every module.",
        defaultSeverity: "warn",
      },
      check(ctx) {
        for (const m of ctx.graph.modules().toArray()) sink.set(rel(m.file ?? m.id), m.kind);
      },
    }),
  );
}

/**
 * The user-visible consequence of the kind decision: "this package may not reach directly
 * into a sibling package's files" is an ordinary boundary rule, expressed against the kind
 * the IR promises. It fires only where the producer actually emits `workspace`.
 */
function crossPackageProbe(): ConfiguredRule<Record<string, never>> {
  return configureRule(
    defineRule<Record<string, never>>({
      meta: {
        name: "no-cross-package-imports",
        description: "Forbids importing a sibling workspace package's files directly.",
        defaultSeverity: "error",
      },
      check(ctx) {
        for (const e of ctx.graph.edges({ toModuleKind: "workspace" })) {
          ctx.report({
            edge: e,
            message: `"${rel(e.from)}" reaches into sibling package file "${rel(e.to)}"`,
          });
        }
      },
    }),
  );
}

function configWith(
  rule: ConfiguredRule<Record<string, never>>,
  collected: Violation[],
): UserConfig {
  return {
    sourceRoot: "packages/app/src",
    rules: [rule],
    failOn: "never",
    reporters: [
      {
        name: "collect",
        onRunEnd: (r) => void collected.push(...r.violations),
      },
    ],
  };
}

/** Runs one config through all four graph producers. */
async function allProducers(
  make: () => ConfiguredRule<Record<string, never>>,
): Promise<Record<"vite" | "rspack" | "webpack" | "cli", Violation[]>> {
  const out = {} as Record<"vite" | "rspack" | "webpack" | "cli", Violation[]>;

  out.vite = [];
  await build({
    root: FIXTURE,
    logLevel: "silent",
    configFile: false,
    plugins: [archwallVite({ config: configWith(make(), out.vite) })],
    build: {
      write: false,
      rollupOptions: { input: path.join(APP_SRC, "main.ts") },
    },
  });

  out.rspack = [];
  await buildWithRspack(new ArchWallPlugin({ config: configWith(make(), out.rspack) }), {
    dir: FIXTURE,
    src: APP_SRC,
  });

  out.webpack = [];
  await buildWithWebpack(new ArchWallPlugin({ config: configWith(make(), out.webpack) }), {
    dir: FIXTURE,
    src: APP_SRC,
  });

  out.cli = [];
  await check({ cwd: FIXTURE, config: configWith(make(), out.cli) });

  return out;
}

describe("monorepo conformance", () => {
  /**
   * The bundler adapters used to have no notion of `workspace` at all: their `kindOf` saw a
   * file that was not under node_modules and returned "source", after which
   * `applyProjectBoundary` re-kinded it "excluded" for lying outside the root. Only the
   * CLI's scanner asked the question the IR was designed for.
   */
  it("every producer assigns the same ModuleKind to a sibling workspace package's file", async () => {
    const sinks = {
      vite: new Map(),
      rspack: new Map(),
      webpack: new Map(),
      cli: new Map(),
    } as Record<"vite" | "rspack" | "webpack" | "cli", Map<string, ModuleKind>>;
    const order: ("vite" | "rspack" | "webpack" | "cli")[] = ["vite", "rspack", "webpack", "cli"];
    let i = 0;
    await allProducers(() => kindProbe(sinks[order[i++]!]));

    // The fixture is only meaningful if every producer actually saw the sibling file.
    for (const host of order)
      expect(sinks[host].get(SIBLING), `${host} never saw ${SIBLING}`).toBeDefined();

    expect({
      vite: sinks.vite.get(SIBLING),
      rspack: sinks.rspack.get(SIBLING),
      webpack: sinks.webpack.get(SIBLING),
      cli: sinks.cli.get(SIBLING),
    }).toEqual({
      vite: "workspace",
      rspack: "workspace",
      webpack: "workspace",
      cli: "workspace",
    });
  }, 240_000);

  /**
   * The consequence that matters: an ordinary boundary rule, written against a kind the IR
   * promises, used to silently enforce nothing under every bundler while passing under the
   * CLI — a direct counter-example to the claim that the same config yields the same answer
   * on every surface.
   */
  it("a rule written against ModuleKind:'workspace' fires identically on every producer", async () => {
    const { vite, rspack, webpack, cli } = await allProducers(crossPackageProbe);
    const count = (vs: Violation[]) => vs.length;
    expect({
      vite: count(vite),
      rspack: count(rspack),
      webpack: count(webpack),
      cli: count(cli),
    }).toEqual({ vite: 1, rspack: 1, webpack: 1, cli: 1 });
  }, 240_000);
});
