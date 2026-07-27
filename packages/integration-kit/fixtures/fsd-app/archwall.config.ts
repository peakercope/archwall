import { defineConfig } from "@archwall/core";
import { fsd } from "@archwall/presets";

export default defineConfig({
  sourceRoot: "src",
  presets: [fsd()],
  reporters: [],
  failOn: "error",
});
