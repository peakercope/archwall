import * as path from "node:path";
import type { Reporter, Violation } from "@archwall/integration-kit";
import { assertViolationsMatch, FSD_APP_EXPECTED } from "@archwall/integration-kit";
import { fsd } from "@archwall/presets";
import archwall from "@archwall/vite";
import { build } from "vite";
import { describe, expect, it } from "vitest";

const fixtureDir = path.resolve(import.meta.dirname, "../../integration-kit/fixtures/fsd-app");
const srcRoot = path.join(fixtureDir, "src");

function viteBuild(plugin: ReturnType<typeof archwall>) {
  return build({
    root: fixtureDir,
    logLevel: "silent",
    configFile: false,
    plugins: [plugin],
    resolve: { alias: { "@": srcRoot } },
    build: {
      write: false,
      rollupOptions: { input: path.join(srcRoot, "main.ts") },
    },
  });
}

describe("@archwall/vite build mode", () => {
  it("collects the real graph and reports the fixture's seeded violations", async () => {
    const collected: Violation[] = [];
    const collector: Reporter = {
      name: "collect",
      onRunEnd: (r) => {
        collected.push(...r.violations);
      },
    };
    await viteBuild(
      archwall({
        config: {
          sourceRoot: "src",
          presets: [fsd()],
          reporters: [collector],
          failOn: "never",
        },
      }),
    );
    assertViolationsMatch(collected, srcRoot, FSD_APP_EXPECTED);
  }, 60_000);

  it("fails the build per failOn: error (discovering archwall.config.ts)", async () => {
    await expect(viteBuild(archwall())).rejects.toThrow(/error\(s\)/);
  }, 60_000);
});
