import { readFileSync } from "node:fs";
import type { UserConfig } from "tsdown";

/**
 * Reads `IR_VERSION` out of core's source.
 *
 * Read rather than imported: tsdown loads this config with a native `import`, which cannot
 * resolve the `.js` specifier of a `.ts` source file. Throwing on a miss is deliberate — a
 * silently absent version would ship every adapter with the wrong constant baked in, and the
 * build is the only place that can still catch it.
 */
function readIrVersion(): string {
  const source = readFileSync("./packages/core/src/graph/ir.ts", "utf8");
  const match = /export const IR_VERSION = "([^"]+)"/.exec(source);
  if (match === null) {
    throw new Error(
      'tsdown.shared.ts: could not find `export const IR_VERSION = "…"` in ' +
        "packages/core/src/graph/ir.ts. If the declaration moved, update this reader — see " +
        "docs/adr/0021-adapters-bake-their-ir-version.md.",
    );
  }
  return match[1]!;
}

/**
 * Options shared by every package build.
 *
 * Spread these explicitly into each config rather than relying on tsdown's
 * root-config inheritance — the docs do not specify whether a package-level
 * config merges with the root config or replaces it, and spreading makes the
 * question moot.
 */
export const shared = {
  entry: ["src/index.ts"],
  /**
   * Freezes the IR version into every package at build time.
   *
   * `@archwall/integration-kit` stamps it onto the graphs it builds so that
   * `assertIrCompatible` has an adapter-side version to compare, rather than
   * comparing core's constant to itself.
   *
   * See docs/adr/0021-adapters-bake-their-ir-version.md.
   */
  define: { __ARCHWALL_IR_VERSION__: JSON.stringify(readIrVersion()) },
  format: ["esm", "cjs"],
  platform: "node",
  target: "node22",
  dts: true,
  sourcemap: true,
  clean: true,
  exports: { devExports: true },
  publint: true,
  attw: true,
} satisfies UserConfig;
