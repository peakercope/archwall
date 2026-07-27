import * as path from "node:path";
import archwall from "@archwall/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // With no arguments the plugin discovers `archwall.config.ts` next to this file.
    // Pass `archwall({ config: "./path/to/config.ts" })` to point somewhere else, or
    // `archwall({ config: { … } })` to inline the config object.
    archwall(),
  ],
  resolve: {
    // ArchWall validates the graph *after* resolution, so it sees whatever Vite sees.
    // This alias must also be mirrored in tsconfig.json `paths` — Vite does not read those,
    // and the ArchWall CLI reads only those.
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});
