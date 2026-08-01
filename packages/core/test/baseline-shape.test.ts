import { analyze, DIAGNOSTIC_GATES, resolveConfig, resolveFailOnDiagnostics } from "@archwall/core";
import { buildFixtureGraph } from "@archwall/test-utils";
import { describe, expect, it } from "vitest";

/**
 * The baseline contract as seen from the ENGINE.
 *
 * Suppression is implemented at the run edge (`@archwall/integration-kit`), never here: it is
 * policy, exactly like `failOn`, and an engine that filtered its own output would make
 * `result.violations` mean different things to different callers. So what these assert is that
 * `analyze` stays inert about baselines — it resolves the path, it declares the field, and it
 * suppresses nothing. `test/baseline.test.ts` covers the file format; the run-edge behaviour
 * lives in `@archwall/integration-kit`'s `test/baseline.test.ts`.
 */

const graph = () =>
  buildFixtureGraph({
    modules: ["/repo/a.ts", "/repo/b.ts"],
    edges: [["/repo/a.ts", "/repo/b.ts"]],
  });

describe("baseline contract in the engine", () => {
  it("gives every result a `suppressed` list, which the engine itself never fills", async () => {
    const result = await analyze(graph(), resolveConfig({}, { cwd: "/repo" }));
    expect(result.suppressed).toEqual([]);
  });

  it("does not suppress even when a baseline is configured — that is the run edge's job", async () => {
    const config = resolveConfig({ baseline: "baseline.json" }, { cwd: "/repo" });
    const result = await analyze(graph(), config);
    expect(result.suppressed).toEqual([]);
    // And it does not go looking for the file either: core has no filesystem by construction.
    expect(result.diagnostics.filter((d) => d.code === "baseline-invalid")).toEqual([]);
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
