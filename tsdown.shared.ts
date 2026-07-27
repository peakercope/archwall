import type { UserConfig } from "tsdown";

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
