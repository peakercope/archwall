import { defineConfig } from "tsdown";

import { shared } from "../../tsdown.shared.ts";

// src/bin.ts is the CLI executable. The command name must be spelled out:
// tsdown's auto-detection derives it from the package name minus the scope,
// which would rename the published command from `archwall` to `cli`.
//
// `exclude` keeps bin out of `exports`. tsdown generates one export subpath per
// entry, but src/bin.ts is an executable, not an importable module - nothing
// imports `@archwall/cli/bin`, and node10 cannot resolve a subpath at all
// (it ignores `exports`), so the entry only produced an attw failure. The `bin`
// field is generated separately and still points at ./dist/bin.mjs.
export default defineConfig({
  ...shared,
  entry: ["src/index.ts", "src/bin.ts"],
  exports: {
    ...shared.exports,
    bin: { archwall: "./src/bin.ts" },
    exclude: ["bin"],
  },
});
