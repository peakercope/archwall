import type { Reporter, Violation } from "@archwall/core";
import { assertViolationsMatch, FSD_APP_EXPECTED } from "@archwall/integration-kit";
import { fsd } from "@archwall/presets";
import ArchWallPlugin from "@archwall/rspack";
import { describe, expect, it } from "vitest";
import { buildWithWebpack, srcRoot } from "./bundlers.js";

describe("@archwall/rspack with webpack", () => {
  it("collects the real graph and reports the fixture's seeded violations", async () => {
    const collected: Violation[] = [];
    const collector: Reporter = {
      name: "collect",
      onRunEnd: (r) => {
        collected.push(...r.violations);
      },
    };
    const outcome = await buildWithWebpack(
      new ArchWallPlugin({
        config: {
          sourceRoot: "src",
          presets: [fsd()],
          reporters: [collector],
          failOn: "never",
        },
      }),
    );
    expect(outcome.hasErrors, outcome.text).toBe(false);
    assertViolationsMatch(collected, srcRoot, FSD_APP_EXPECTED);
  }, 60_000);

  it("attaches import locations, which webpack — unlike Rspack — exposes", async () => {
    const collected: Violation[] = [];
    const collector: Reporter = {
      name: "collect",
      onRunEnd: (r) => {
        collected.push(...r.violations);
      },
    };
    await buildWithWebpack(
      new ArchWallPlugin({
        config: {
          sourceRoot: "src",
          presets: [fsd()],
          reporters: [collector],
          failOn: "never",
        },
      }),
    );
    const layered = collected.find((v) => v.ruleName === "layer-dependencies");
    // shared/lib/bad.ts imports widgets on its first line.
    expect(layered?.edge?.loc).toMatchObject({ line: 1 });
  }, 60_000);

  it("fails the build per failOn: error (discovering archwall.config.ts)", async () => {
    const outcome = await buildWithWebpack(new ArchWallPlugin());
    expect(outcome.hasErrors).toBe(true);
    expect(outcome.text).toMatch(/error\(s\)/);
  }, 60_000);
});
