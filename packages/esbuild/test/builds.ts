import * as path from "node:path";
import type { EsbuildPluginLike } from "@archwall/esbuild";
import type { Plugin } from "esbuild";

/**
 * Shared esbuild build helper.
 *
 * Not a `*.test.ts` file, so the root vitest glob does not pick it up — the convention
 * `packages/rspack/test/bundlers.ts` established so the cross-producer suites in
 * `@archwall/cli` can drive every bundler from one place.
 */

export const fixturesRoot = path.resolve(import.meta.dirname, "../../integration-kit/fixtures");

/** Locates any conformance fixture by name; every one is `<name>/src/main.ts` + a `@` alias. */
export function fixture(name: string): { dir: string; src: string } {
  const dir = path.join(fixturesRoot, name);
  return { dir, src: path.join(dir, "src") };
}

export interface EsbuildBuildOptions {
  where?: { dir: string; src: string };
  /** Off for the test that proves `complete-graph` is not claimed without it. */
  bundle?: boolean;
  /**
   * Keeps a dependency out of the bundle, so it arrives as a bare specifier rather than as
   * a tree of resolved node_modules files. Node builtins are already external under
   * `platform: "node"`.
   */
  external?: string[];
}

/**
 * Builds a fixture with esbuild in memory.
 *
 * `absWorkingDir` is the fixture root because metafile keys are relative to it, and
 * `tsconfig` is passed explicitly so the `@/*` path alias resolves the same way it does
 * under every other host.
 */
export async function buildWithEsbuild(
  plugin: EsbuildPluginLike,
  opts: EsbuildBuildOptions = {},
): Promise<void> {
  const { build } = await import("esbuild");
  const where = opts.where ?? fixture("fsd-app");
  const bundle = opts.bundle ?? true;
  await build({
    entryPoints: [path.join(where.src, "main.ts")],
    bundle,
    write: false,
    platform: "node",
    format: "esm",
    absWorkingDir: where.dir,
    tsconfig: path.join(where.dir, "tsconfig.json"),
    logLevel: "silent",
    // esbuild rejects `external` outright when not bundling — there is nothing to keep out.
    ...(bundle ? { external: opts.external ?? ["react"] } : {}),
    plugins: [plugin as Plugin],
  });
}
