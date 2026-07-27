import { defineConfig } from "tsdown";

import { shared } from "../../tsdown.shared.ts";

// ESM-only: src/index.ts has a runtime value import of vite@8, which is
// itself ESM-only, so a CJS build would emit an unusable require("vite").
// No CommonJS-only project can load Vite 8 anyway, so nothing would consume it.
//
// attw's default `strict` profile demands a node10 and a CJS resolution, which
// an ESM-only package has no honest way to provide: tsdown omits main/module/
// types for a single-format build, and node10 cannot read `exports` at all. The
// `esm-only` profile drops exactly those two resolution modes and keeps the
// checks that still apply.
export default defineConfig({
  ...shared,
  format: ["esm"],
  attw: { profile: "esm-only" },
});
