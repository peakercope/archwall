import { defineConfig } from "@archwall/core";
import { modules } from "@archwall/presets";

export default defineConfig({
  sourceRoot: "src",
  presets: [
    modules({
      root: "modules",
      shared: ["shared"],
      depends: { billing: ["identity"] },
    }),
  ],
  reporters: [],
  failOn: "error",
});
