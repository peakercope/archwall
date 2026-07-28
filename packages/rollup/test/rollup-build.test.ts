import * as path from "node:path";
import type { Reporter, UserConfig, Violation } from "@archwall/core";
import { assertViolationsMatch, FSD_APP_EXPECTED } from "@archwall/integration-kit";
import { fsd } from "@archwall/presets";
import archwallRollup from "@archwall/rollup";
import { noDeepImports } from "@archwall/rules";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import type { Plugin } from "rollup";
import { rollup } from "rollup";
import { describe, expect, it } from "vitest";

/**
 * The Rollup adapter, exercised as its own host.
 *
 * This code used to live inside `@archwall/vite`, where every line of it was Rollup and
 * nothing was Vite-specific except dev mode — so Rollup users could not have it at all,
 * and no test ever ran it against a plain Rollup build. Extracting it makes both possible;
 * this suite is the proof that the extraction is real rather than nominal.
 */
const FIXTURE = path.resolve(import.meta.dirname, "../../integration-kit/fixtures/fsd-app");
const SRC = path.join(FIXTURE, "src");

async function build(config: UserConfig): Promise<{ violations: Violation[]; failed: boolean }> {
  const violations: Violation[] = [];
  const collector: Reporter = {
    name: "collect",
    onRunEnd(result) {
      violations.push(...result.violations);
    },
  };
  let failed = false;
  const bundle = await rollup({
    input: path.join(SRC, "main.ts"),
    logLevel: "silent",
    onwarn() {},
    plugins: [
      // FIRST, deliberately: Rollup's `resolveId` is first-wins, so an adapter placed after
      // the resolvers never observes what the author wrote. See the `raw-specifiers` test.
      archwallRollup({
        config: { ...config, reporters: [collector] },
        cwd: () => FIXTURE,
      }) as Plugin,
      nodeResolve({ extensions: [".ts", ".js"] }),
      typescript({
        tsconfig: path.join(FIXTURE, "tsconfig.json"),
        compilerOptions: { noEmit: false, declaration: false, sourceMap: false },
      }),
    ],
  }).catch((err: unknown) => {
    failed = true;
    throw err;
  });
  await bundle.close();
  return { violations, failed };
}

describe("@archwall/rollup", () => {
  it("reports exactly the fixture's known violations, like every other producer", async () => {
    const { violations } = await build({
      sourceRoot: "src",
      presets: [fsd()],
      failOn: "never",
    });
    assertViolationsMatch(violations, SRC, FSD_APP_EXPECTED);
  }, 120_000);

  it("records what the author wrote when ordered before the resolvers", async () => {
    const { violations } = await build({
      sourceRoot: "src",
      presets: [fsd()],
      failOn: "never",
    });
    const withSpecifier = violations.find((v) =>
      v.locations.some((l) => l.type === "edge" && l.edge.rawSpecifier.startsWith("@/")),
    );
    expect(withSpecifier, "no violation carried an author-written specifier").toBeDefined();
  }, 120_000);

  it("skips specifier rules loudly when it could not observe specifiers", async () => {
    // Ordered LAST, so the resolvers answer every `resolveId` first and this adapter never
    // sees a raw specifier. Claiming the capability anyway would make `no-deep-imports`
    // match nothing and report a clean run — the silent failure capabilities exist to
    // prevent. The claim is therefore made from evidence, not from intent.
    const violations: Violation[] = [];
    const diagnostics: string[] = [];
    const bundle = await rollup({
      input: path.join(SRC, "main.ts"),
      logLevel: "silent",
      onwarn() {},
      plugins: [
        nodeResolve({ extensions: [".ts", ".js"] }),
        typescript({
          tsconfig: path.join(FIXTURE, "tsconfig.json"),
          compilerOptions: { noEmit: false, declaration: false, sourceMap: false },
        }),
        archwallRollup({
          cwd: () => FIXTURE,
          config: {
            sourceRoot: "src",
            failOn: "never",
            rules: [noDeepImports({ forbiddenSpecifiers: ["@/features/*/**"] })],
            reporters: [
              {
                name: "collect",
                onRunEnd(result) {
                  violations.push(...result.violations);
                  diagnostics.push(...result.diagnostics.map((d) => d.code));
                },
              },
            ],
          },
        }) as Plugin,
      ],
    });
    await bundle.close();
    expect(diagnostics).toContain("rule-skipped");
    expect(violations).toHaveLength(0);
  }, 120_000);

  it("fails the build per failOn", async () => {
    await expect(build({ sourceRoot: "src", presets: [fsd()], failOn: "error" })).rejects.toThrow(
      /archwall: \d+ error/,
    );
  }, 120_000);
});
