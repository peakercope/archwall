import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { check } from "@archwall/cli";
import type { UserConfig } from "@archwall/core";
import { fsd } from "@archwall/presets";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Brownfield adoption, end to end, over a fixture with real violations found by a real preset.
 *
 * The scenario this exists for: a five-year-old repo turns ArchWall on, sees a wall of
 * findings, accepts them, and gets a green CI it can then ratchet down. If that path breaks,
 * the tool is greenfield-only regardless of what the unit tests say.
 */

const fixtureDir = path.resolve(import.meta.dirname, "../../integration-kit/fixtures/fsd-app");

let baselineFile: string;
let tmp: string;

beforeEach(() => {
  // Outside the fixture: an absolute `baseline` resolves to itself, which keeps the test from
  // writing into a directory the rest of the suite reads.
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archwall-cli-baseline-"));
  baselineFile = path.join(tmp, "archwall-baseline.json");
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const config = (over: Partial<UserConfig> = {}): UserConfig => ({
  sourceRoot: "src",
  presets: [fsd()],
  reporters: [],
  baseline: baselineFile,
  ...over,
});

const silentIO = { open: () => ({ write: () => {} }) };
const run = (over: Partial<UserConfig> = {}, updateBaseline = false) =>
  check({ cwd: fixtureDir, config: config(over), io: silentIO, updateBaseline });

describe("archwall check --update-baseline", () => {
  it("takes a failing repo to a green one, then reports the accepted count", async () => {
    const before = await run();
    // Configured but absent — the first run tells you so rather than passing quietly.
    expect(before.result.diagnostics.map((d) => d.code)).toContain("baseline-invalid");
    expect(before.result.violations.length).toBeGreaterThan(0);
    expect(before.failed).toBe(true);

    const written = await run({}, true);
    expect(written.baselineWritten).toBe(baselineFile);
    expect(written.failed).toBe(false);

    const after = await run();
    expect(after.result.violations).toEqual([]);
    expect(after.result.suppressed.length).toBe(before.result.violations.length);
    expect(after.failed).toBe(false);
    expect(after.summary).toContain(`${after.result.suppressed.length} suppressed`);
  });

  it("writes a file a human can review, not a wall of hashes", async () => {
    await run({}, true);
    const doc = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
    expect(doc.scheme).toBe("aw3");
    for (const entry of doc.entries) {
      expect(entry.fingerprint).toMatch(/^aw3:[0-9a-f]{16}$/);
      expect(entry.ruleId).toMatch(/^fsd\//);
      // Repo-relative, never a path from the machine that wrote it.
      expect(entry.location).not.toMatch(/^\//);
      expect(entry.message.length).toBeGreaterThan(0);
    }
  });

  it("is byte-identical when nothing changed, so a no-op regeneration is an empty diff", async () => {
    await run({}, true);
    const first = fs.readFileSync(baselineFile, "utf8");
    await run({}, true);
    expect(fs.readFileSync(baselineFile, "utf8")).toBe(first);
  });

  it("reports entries as stale once the code they were about is gone", async () => {
    await run({}, true);
    // Narrowing `include` removes a slice of the project, which retires every finding in it —
    // the same shape as someone deleting or fixing that code.
    const narrowed = await run({ include: ["src/features/auth/**"] });
    const stale = narrowed.result.diagnostics.filter((d) => d.code === "baseline-stale");
    expect(stale).toHaveLength(1);
    expect((stale[0]!.details as { count: number }).count).toBeGreaterThan(0);
    // Still green: fixing things must not fail the build.
    expect(narrowed.failed).toBe(false);
  });
});
