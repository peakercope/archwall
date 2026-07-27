import * as fs from "node:fs";
import * as path from "node:path";
import { check } from "@archwall/cli";
import { describe, expect, it } from "vitest";

const exampleDir = path.resolve(import.meta.dirname, "../../../examples/clean-node");

describe("examples/clean-node", () => {
  it("is green, so the documented example never rots", async () => {
    // Runs the exact path a reader takes: the example's own archwall.config.ts via
    // config-file discovery, the layered preset, and the CLI's own graph producer.
    const { result, failed } = await check({ cwd: exampleDir });
    expect(result.violations).toEqual([]);
    expect(failed).toBe(false);
    expect(result.stats.moduleCount).toBeGreaterThan(5);
  }, 60_000);

  it("reports exactly the violations its comments promise when they are uncommented", async () => {
    const files = [
      path.join(exampleDir, "src/domain/registration.ts"),
      path.join(exampleDir, "src/application/register-user.ts"),
    ];
    const originals = files.map((f) => fs.readFileSync(f, "utf8"));
    try {
      // Un-comment the two seeded "Try it:" imports.
      files.forEach((f, i) =>
        fs.writeFileSync(f, originals[i]!.replace(/^\/\/ (import .+)$/gm, "$1")),
      );

      const { result, failed } = await check({ cwd: exampleDir });
      expect(result.violations.map((v) => v.ruleId).sort()).toEqual([
        "layered/layer-dependencies",
        "layered/purity-domain",
      ]);
      expect(failed).toBe(true);
    } finally {
      files.forEach((f, i) => fs.writeFileSync(f, originals[i]!));
    }
  }, 60_000);
});
