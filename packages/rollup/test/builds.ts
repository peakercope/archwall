import * as path from "node:path";
import type { RollupPluginLike } from "@archwall/rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import type { Plugin } from "rollup";
import { rollup } from "rollup";

/**
 * Shared Rollup build helper.
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

export interface RollupBuildOptions {
  where?: { dir: string; src: string };
  /** Kept out of the bundle so they arrive as bare specifiers rather than parsed CJS. */
  external?: string[];
}

/**
 * Builds a fixture with Rollup in memory.
 *
 * The ArchWall plugin goes FIRST, deliberately: Rollup's `resolveId` is first-wins, so
 * ordered after the resolvers the adapter never observes what the author wrote and
 * correctly stops claiming `raw-specifiers`. Every other producer has those specifiers, so
 * a cross-producer comparison has to give Rollup the position where it does too.
 */
export async function buildWithRollup(
  plugin: RollupPluginLike,
  opts: RollupBuildOptions = {},
): Promise<void> {
  const where = opts.where ?? fixture("fsd-app");
  const bundle = await rollup({
    input: path.join(where.src, "main.ts"),
    logLevel: "silent",
    onwarn() {},
    // `node:path` would otherwise be bundled-and-warned; `react` is CJS and would need
    // @rollup/plugin-commonjs to parse. Neither is what this suite is testing.
    external: opts.external ?? ["react", "node:path"],
    plugins: [
      plugin as Plugin,
      nodeResolve({ extensions: [".ts", ".js"] }),
      typescript({
        tsconfig: path.join(where.dir, "tsconfig.json"),
        compilerOptions: { noEmit: false, declaration: false, sourceMap: false },
      }),
    ],
  });
  await bundle.close();
}
