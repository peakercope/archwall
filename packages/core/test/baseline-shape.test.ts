import { analyze, DIAGNOSTIC_GATES, resolveConfig, resolveFailOnDiagnostics } from "@archwall/core";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

/**
 * The baseline contract, reserved ahead of its implementation.
 *
 * These shapes are on FROZEN types (`AnalysisResult`, `UserConfig`, `ResolvedFailOnDiagnostics`),
 * so the moment to get them right is before they are frozen, not after. What is asserted here is
 * that they exist, resolve, and are inert — a guard against the field quietly changing meaning
 * between now and the release that honours it.
 */

const graph = () =>
  buildFixtureGraph({
    modules: ["/repo/a.ts", "/repo/b.ts"],
    edges: [["/repo/a.ts", "/repo/b.ts"]],
  });

describe("reserved baseline contract", () => {
  it("gives every result a `suppressed` list, empty until suppression is implemented", async () => {
    const result = await analyze(graph(), resolveConfig({}, { cwd: "/repo" }));
    expect(result.suppressed).toEqual([]);
  });

  it("resolves `baseline` to an absolute path against repoRoot", () => {
    const config = resolveConfig(
      { repoRoot: ".", baseline: "archwall-baseline.json" },
      { cwd: "/repo" },
    );
    // Repo-root-relative, not cwd-relative: the file is committed beside the config, and CI
    // must not resolve it differently depending on where it invoked the tool from.
    expect(config.baseline).toBe("/repo/archwall-baseline.json");
  });

  it("leaves `baseline` null when unset, rather than guessing a path", () => {
    expect(resolveConfig({}, { cwd: "/repo" }).baseline).toBeNull();
  });

  it("does not treat an unset baseline as a configuration error", async () => {
    const config = resolveConfig({}, { cwd: "/repo" });
    const result = await analyze(graph(), config);
    expect(result.diagnostics.filter((d) => d.code === "invalid-config")).toEqual([]);
  });

  it("registers the baseline-stale gate, off by default", () => {
    expect(DIAGNOSTIC_GATES.baselineStale).toEqual({
      codes: ["baseline-stale"],
      default: false,
    });
    expect(resolveFailOnDiagnostics(undefined).baselineStale).toBe(false);
    expect(resolveFailOnDiagnostics({ baselineStale: true }).baselineStale).toBe(true);
  });
});
