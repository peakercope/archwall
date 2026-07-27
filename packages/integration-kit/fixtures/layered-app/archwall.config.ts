import { defineConfig } from "@archwall/core";
import { layered } from "@archwall/presets";

export default defineConfig({
  sourceRoot: "src",
  presets: [
    layered({
      layers: ["presentation", "infrastructure", "application", "domain"],
      pure: ["domain"],
    }),
  ],
  reporters: [],
  failOn: "error",
});
