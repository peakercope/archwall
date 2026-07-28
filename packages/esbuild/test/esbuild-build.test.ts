import type { ConfiguredRule } from "@archwall/core";
import { configureRule, defineRule } from "@archwall/core";
import archwallEsbuild from "@archwall/esbuild";
import type { Reporter, UserConfig, Violation } from "@archwall/integration-kit";
import { assertViolationsMatch, FSD_APP_EXPECTED } from "@archwall/integration-kit";
import { fsd } from "@archwall/presets";
import { noDeepImports } from "@archwall/rules";
import { describe, expect, it } from "vitest";
import { buildWithEsbuild, fixture } from "./builds.js";

/**
 * The esbuild adapter, exercised as a real host.
 *
 * esbuild reports its graph only through the metafile, so unlike the hook-driven adapters
 * every claim this package makes is a claim about what the metafile does and does not
 * contain. These tests pin all four.
 */
const { dir: FIXTURE, src: SRC } = fixture("fsd-app");

interface Outcome {
  violations: Violation[];
  diagnostics: string[];
}

async function build(config: UserConfig, opts: { bundle?: boolean } = {}): Promise<Outcome> {
  const violations: Violation[] = [];
  const diagnostics: string[] = [];
  const collector: Reporter = {
    name: "collect",
    onRunEnd(result) {
      violations.push(...result.violations);
      diagnostics.push(...result.diagnostics.map((d) => d.code));
    },
  };
  await buildWithEsbuild(
    archwallEsbuild({
      config: { ...config, reporters: [collector] },
      cwd: () => FIXTURE,
    }),
    { where: { dir: FIXTURE, src: SRC }, ...opts },
  );
  return { violations, diagnostics };
}

const PRESET: UserConfig = { sourceRoot: "src", presets: [fsd()], failOn: "never" };

/** A rule that does nothing but declare it needs the whole graph. */
function wholeGraphProbe(): ConfiguredRule<Record<string, never>> {
  return configureRule(
    defineRule<Record<string, never>>({
      meta: {
        name: "whole-graph",
        description: "Needs the complete graph.",
        defaultSeverity: "warn",
        requiredCapabilities: ["complete-graph"],
      },
      check() {},
    }),
  );
}

describe("@archwall/esbuild", () => {
  it("reports exactly the fixture's known violations, like every other producer", async () => {
    const { violations } = await build(PRESET);
    assertViolationsMatch(violations, SRC, FSD_APP_EXPECTED);
  }, 120_000);

  it("records what the author wrote, with no dependence on plugin order", async () => {
    // The contrast with @archwall/rollup, whose `resolveId` is first-wins and which must
    // therefore claim `raw-specifiers` from evidence. The metafile is written after the
    // fact and keeps `original` regardless of who ran when, so the claim is unconditional.
    const { violations } = await build(PRESET);
    const withSpecifier = violations.find((v) =>
      v.locations.some((l) => l.type === "edge" && l.edge.rawSpecifier.startsWith("@/")),
    );
    expect(withSpecifier, "no violation carried an author-written specifier").toBeDefined();
  }, 120_000);

  it("claims `complete-graph` when bundling, and skips loudly when not", async () => {
    // Without `bundle: true` esbuild never follows an import, so the metafile describes the
    // entry point and nothing else — verified: one input, zero imports. Claiming
    // `complete-graph` anyway would let a whole-graph rule report a clean project rather
    // than an unanalysed one, which is the silent failure capabilities exist to stop.
    //
    // No built-in rule declares `complete-graph`, so the gate is exercised through the
    // public rule API rather than indirectly.
    const bundled = await build({ ...PRESET, presets: [], rules: [wholeGraphProbe()] });
    expect(bundled.diagnostics).not.toContain("rule-skipped");

    const unbundled = await build(
      { ...PRESET, presets: [], rules: [wholeGraphProbe()] },
      { bundle: false },
    );
    expect(unbundled.diagnostics).toContain("rule-skipped");
    expect(unbundled.violations).toHaveLength(0);
  }, 120_000);

  it("fails the build per failOn", async () => {
    await expect(build({ sourceRoot: "src", presets: [fsd()], failOn: "error" })).rejects.toThrow(
      /archwall: \d+ error/,
    );
  }, 120_000);

  it("still runs specifier rules when nothing else is configured", async () => {
    // `no-deep-imports` needs only `raw-specifiers`, which this host always has — so unlike
    // the Rollup suite's equivalent case there is no ordering under which it goes quiet.
    const { violations, diagnostics } = await build({
      sourceRoot: "src",
      failOn: "never",
      rules: [noDeepImports({ forbiddenSpecifiers: ["@/features/*/**"] })],
    });
    expect(diagnostics).not.toContain("rule-skipped");
    expect(violations.length).toBeGreaterThan(0);
  }, 120_000);
});
