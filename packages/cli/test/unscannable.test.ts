import * as path from "node:path";
import { buildGraphFromFilesystem, check, cliHost } from "@archwall/cli";
import type { UnscannableFilesDetails } from "@archwall/core";
import { resolveConfig } from "@archwall/core";
import { describe, expect, it } from "vitest";

/**
 * The CLI's silent blind spot.
 *
 * The scanner lexes JS/TS only, so a `.vue` component was previously absent from the graph
 * with no module, no edge, and no warning — the tool's own worst failure mode (looking like it
 * worked) reproduced in the one producer most people run in CI.
 */
const FIXTURE = path.resolve(import.meta.dirname, "../../integration-kit/fixtures/unscannable-app");

const configFor = (overrides: Record<string, unknown> = {}) =>
  resolveConfig({ sourceRoot: "src", ...overrides }, { cwd: FIXTURE });

describe("unscannable-files", () => {
  it("reports in-boundary files the scanner cannot read", async () => {
    const { diagnostics } = await buildGraphFromFilesystem(configFor(), cliHost());
    const d = diagnostics.find((x) => x.code === "unscannable-files");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warn");

    const details = d?.details as unknown as UnscannableFilesDetails;
    expect(details.count).toBe(1);
    expect(details.extensions).toEqual([".vue"]);
    expect(details.sample).toEqual(["components/Widget.vue"]);
    // The message must name the thing to act on, not just that something happened.
    expect(d?.message).toContain(".vue");
  });

  it("stays silent when every in-boundary file is scannable", async () => {
    const { diagnostics } = await buildGraphFromFilesystem(
      configFor({ exclude: ["**/*.vue"] }),
      cliHost(),
    );
    expect(diagnostics).toEqual([]);
  });

  /**
   * The difference the two globs are taken over is `include`/`exclude`-filtered on BOTH sides,
   * so a deliberately excluded file must not be reported as a blind spot — otherwise the
   * diagnostic becomes noise and gets ignored, which is worse than not having it.
   */
  it("does not count files the user excluded on purpose", async () => {
    const { diagnostics } = await buildGraphFromFilesystem(
      configFor({ exclude: ["components/**"] }),
      cliHost(),
    );
    expect(diagnostics).toEqual([]);
  });

  it("surfaces through check() into result.diagnostics", async () => {
    const { result } = await check({ cwd: FIXTURE });
    expect(result.diagnostics.map((d) => d.code)).toContain("unscannable-files");
  });

  it("does not fail the run by default", async () => {
    const { failed } = await check({ cwd: FIXTURE });
    expect(failed).toBe(false);
  });

  it("fails the run when the gate is enabled", async () => {
    const { failed } = await check({
      cwd: FIXTURE,
      config: {
        sourceRoot: "src",
        reporters: [],
        failOn: "never",
        failOnDiagnostics: { unscannableFiles: true },
      },
    });
    expect(failed).toBe(true);
  });
});
