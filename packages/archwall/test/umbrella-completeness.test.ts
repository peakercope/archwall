import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readBarrelSurface } from "../../core/test/support/exported-symbols.js";

/**
 * Values are compared at runtime and types from source, and the split is what makes the check
 * sharp. A symbol core exports as a class but the umbrella re-exports with `export type` is
 * missing from the umbrella's runtime namespace while looking entirely correct in its source
 * — only the runtime comparison sees it. That is not hypothetical: `ProjectGraph` and
 * `GraphQuery` are classes in core and were re-exported as types here, so `new ProjectGraph()`
 * failed for anyone importing from `archwall`.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const CORE_BARREL = path.resolve(here, "../../core/src/index.ts");
const UMBRELLA_BARREL = path.resolve(here, "../src/index.ts");

function assertComplete(missing: readonly string[], kind: string): void {
  if (missing.length === 0) return;
  throw new Error(
    `The \`archwall\` umbrella is missing ${missing.length} public ${kind}(s) from ` +
      "@archwall/core. It requires the umbrella to re-export everything public from " +
      'core; the way it holds that is `export * from "@archwall/core";`.\n  ' +
      missing.toSorted().join("\n  "),
  );
}

describe("archwall umbrella completeness", () => {
  it("re-exports every public value from core", async () => {
    const core = Object.keys(await import("@archwall/core"));
    const umbrella = new Set(Object.keys(await import("archwall")));
    assertComplete(
      core.filter((name) => !umbrella.has(name)),
      "value",
    );
  });

  /**
   * Reported separately from the count above because "missing at runtime" and "mis-tagged as
   * a type" have different fixes, and the message should say which one happened.
   */
  it("re-exports core's values as values, not as types", async () => {
    const coreValues = new Set(Object.keys(await import("@archwall/core")));
    const misTagged = readBarrelSurface(UMBRELLA_BARREL)
      .types.filter((name) => coreValues.has(name))
      .toSorted();
    expect(
      misTagged,
      `Re-exported with \`export type\` but a value in core: ${misTagged.join(", ")}. ` +
        "Consumers of `archwall` can neither call nor construct these.",
    ).toEqual([]);
  });

  it("re-exports every public type from core", () => {
    const umbrella = readBarrelSurface(UMBRELLA_BARREL);
    // `export * from "@archwall/core"` re-exports the whole barrel; there is nothing to
    // enumerate and nothing that can drift.
    if (umbrella.starReexports.includes("@archwall/core")) return;

    const named = new Set([...umbrella.types, ...umbrella.values]);
    assertComplete(
      readBarrelSurface(CORE_BARREL).types.filter((name) => !named.has(name)),
      "type",
    );
  });

  it("does not expose @archwall/core/internal", () => {
    // Asked of the export declarations, not of the file's text: the header comment names
    // `/internal` precisely to say it is excluded, and a substring check would read that
    // sentence as the violation it warns against.
    expect(
      readBarrelSurface(UMBRELLA_BARREL).sources,
      "The umbrella is the stable, user-facing package, so nothing unstable may reach users through it.",
    ).not.toContain("@archwall/core/internal");
  });
});
