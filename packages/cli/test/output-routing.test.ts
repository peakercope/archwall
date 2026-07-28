import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

const FIXTURE = path.resolve(import.meta.dirname, "../../integration-kit/fixtures/fsd-app");
const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");
// Run from the repo root and point the CLI at the fixture with `--cwd`: `npx` relocates
// the working directory to the nearest package root, which would otherwise silently
// change which config the CLI discovers.
const REPO = path.resolve(import.meta.dirname, "../../..");

/**
 * Machine-readable output must be machine-readable.
 *
 * `archwall check --reporter json` used to write the JSON document and then the human
 * summary to the same stdout, so `> out.json` produced a file that was not JSON — in the
 * CI path, which is the one that matters most and is least likely to be exercised by hand.
 *
 * Two things fix it, and both are asserted here: the summary goes to stderr, and each
 * reporter can be given its own destination.
 */
async function archwall(args: string[]) {
  try {
    const { stdout, stderr } = await run("npx", ["tsx", BIN, ...args, "--cwd", FIXTURE], {
      cwd: REPO,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout: string; stderr: string; code: number };
    return { stdout: e.stdout, stderr: e.stderr, code: e.code };
  }
}

describe("CLI output routing", () => {
  it("keeps stdout pure JSON, with the summary on stderr", async () => {
    const { stdout, stderr } = await archwall([
      "check",
      "--reporter",
      "json",
      "--fail-on",
      "never",
    ]);
    // The whole point: this parses.
    const doc = JSON.parse(stdout);
    expect(Array.isArray(doc.violations)).toBe(true);
    expect(stdout).not.toMatch(/error\(s\), .* warning\(s\)/);
    expect(stderr).toMatch(/^archwall: \d+ error\(s\)/m);
  }, 120_000);

  it("sends a reporter to a file when told to, leaving stdout for the other one", async () => {
    const out = path.join(FIXTURE, "archwall-test.sarif");
    fs.rmSync(out, { force: true });
    try {
      const { stdout } = await archwall([
        "check",
        "--reporter",
        "console",
        "--reporter",
        "sarif",
        "--output",
        out,
        "--fail-on",
        "never",
      ]);
      const sarif = JSON.parse(fs.readFileSync(out, "utf8"));
      expect(sarif.version).toBe("2.1.0");
      expect(sarif.runs[0].results.length).toBeGreaterThan(0);
      // The console reporter still went to the terminal, and its text never reached SARIF.
      expect(stdout).toMatch(/error\(s\), .* warning\(s\)/);
    } finally {
      fs.rmSync(out, { force: true });
    }
  }, 120_000);

  it("rejects an --output with no reporter to attach it to, rather than guessing", async () => {
    const { code, stderr } = await archwall(["check", "--output", "x.json"]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/--output must follow a --reporter/);
  }, 120_000);
});
