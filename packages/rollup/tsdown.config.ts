import { defineConfig } from "tsdown";

import { shared } from "../../tsdown.shared.ts";

// ESM-only, matching the hosts this adapter plugs into: Rollup 4 and Vite are both
// ESM-first, so a CJS build would emit a `require` nothing could consume.
//
// attw's default `strict` profile demands a node10 and a CJS resolution, which an ESM-only
// package has no honest way to provide: tsdown omits main/module/types for a single-format
// build, and node10 cannot read `exports` at all. The `esm-only` profile drops exactly
// those two resolution modes and keeps the checks that still apply.
export default defineConfig({
  ...shared,
  format: ["esm"],
  attw: { profile: "esm-only" },
});
