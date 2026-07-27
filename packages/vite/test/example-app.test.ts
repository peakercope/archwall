import * as path from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";

const exampleDir = path.resolve(import.meta.dirname, "../../../examples/vite");

describe("examples/vite", () => {
  it("builds clean, so the documented example never rots", async () => {
    // The example sets failOn: "error", so buildEnd calls this.error() on any
    // violation and the build rejects. Resolving IS the assertion that it is green.
    //
    // This runs the exact path a reader takes: the example's own vite.config.ts, the
    // plugin with no arguments, config-file discovery, and the hand-written classifier.
    await expect(
      build({
        root: exampleDir,
        configFile: path.join(exampleDir, "vite.config.ts"),
        configLoader: "runner",
        logLevel: "silent",
        build: { write: false },
      }),
    ).resolves.toBeDefined();
  }, 120_000);
});
