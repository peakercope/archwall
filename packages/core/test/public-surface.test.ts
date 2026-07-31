import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diffSymbols, readBarrelSurface } from "./support/exported-symbols.js";

/**
 * The frozen public surface of `@archwall/core`.
 *
 * Editing either list IS the review gate. There is deliberately no `--update`: a regenerable
 * snapshot turns "the public API changed" into one keystroke and a diff line reviewers skim,
 * and the whole point of ADR-0018 is that this line gets drawn on purpose rather than by
 * whichever internal a popular downstream package happened to reach for.
 *
 * Adding a name here is a minor release. Removing one is a MAJOR. Anything that is neither
 * belongs in `src/internal.ts`, which has no list because it has no guarantee.
 *
 * See docs/adr/0018-public-and-internal-core-surface.md.
 */
const PUBLIC_VALUES = [
  "analyze",
  "ArchWallError",
  "assertIrCompatible",
  "BUILTIN_REPORTER_NAMES",
  "compareViolations",
  "configureRule",
  "consoleReporter",
  "countBySeverity",
  "defaultIO",
  "defineClassifier",
  "defineConfig",
  "defineGraphComputation",
  "definePreset",
  "defineReporter",
  "defineRule",
  "defineTransform",
  "DIAGNOSTIC_GATES",
  "displayModuleId",
  "dropSelfEdges",
  "failingDiagnosticCodes",
  "fingerprintOf",
  "FINGERPRINT_SCHEME",
  "FIRST_PARTY_KINDS",
  "formatViolation",
  "GraphQuery",
  "IR_VERSION",
  "irMajor",
  "IrVersionMismatchError",
  "isBuiltinReporterName",
  "isFirstParty",
  "isThirdParty",
  "jsonReporter",
  "locationsOf",
  "matchCaptures",
  "matchesPattern",
  "MODULE_ID_SCHEMES",
  "parseModuleId",
  "pathClassifier",
  "primaryEdge",
  "primaryModule",
  "primarySourceLocation",
  "ProjectGraph",
  "renderMessage",
  "resolveConfig",
  "resolveFailOnDiagnostics",
  "resolveReporters",
  "sarifReporter",
  "stronglyConnectedComponents",
  "THIRD_PARTY_KINDS",
].toSorted();

/**
 * Tracked, not capped. Types cost nothing at runtime and a rich type surface is most of the
 * point of a typed linter; what they cost is compatibility obligation, which is why they are
 * enumerated here rather than left to accumulate unnoticed.
 */
const PUBLIC_TYPES = [
  "AnalysisResult",
  "AnalysisStats",
  "BuiltinReporterName",
  "CallableRule",
  "Capability",
  "Classifier",
  "ClassifierContext",
  "ConfiguredRule",
  "Diagnostic",
  "DiagnosticCode",
  "DiagnosticSeverity",
  "Edge",
  "EdgeFilter",
  "EdgeKind",
  "EmptyScopeDetails",
  "FailOn",
  "FailOnDiagnostics",
  "GraphComputation",
  "GraphDelivery",
  "GraphMutation",
  "GraphTransform",
  "HostInfo",
  "ModuleFilter",
  "ModuleId",
  "ModuleIdScheme",
  "ModuleKind",
  "ModuleNode",
  "ModuleSelection",
  "OutputDestination",
  "OutputSink",
  "PathClassifierOptions",
  "PathPattern",
  "Preset",
  "PresetMeta",
  "PresetSpec",
  "ProjectGraphInit",
  "Reporter",
  "ReporterIO",
  "ReporterOutputSpec",
  "ReporterSpec",
  "ResolvedConfig",
  "ResolvedFailOnDiagnostics",
  "ResolvedReporters",
  "ResolvedRule",
  "Rule",
  "RuleContext",
  "RuleDeprecation",
  "RuleMeta",
  "RuleOverride",
  "RuleRunInfo",
  "RuleScope",
  "RuleSettings",
  "RuleSkippedDetails",
  "RuleSpec",
  "RuleVisitors",
  "RunInfo",
  "Severity",
  "SeverityCounts",
  "SourceLocation",
  "StandardSchemaIssue",
  "StandardSchemaResult",
  "StandardSchemaV1",
  "TagPatch",
  "TransformContext",
  "UserConfig",
  "Violation",
  "ViolationInput",
  "ViolationLocation",
  "WellKnownCapability",
  "WellKnownDiagnosticCode",
  "WellKnownEdgeKind",
].toSorted();

/**
 * The ceiling from ADR-0018 — a limit on how much of the engine leaks out as a compatibility
 * obligation, not on ambition. The margin below it is the budget for 1.x additions.
 */
const MAX_PUBLIC_VALUES = 60;

const here = path.dirname(fileURLToPath(import.meta.url));
const CORE_BARREL = path.resolve(here, "../src/index.ts");
const INTERNAL_BARREL = path.resolve(here, "../src/internal.ts");

function assertNoDrift(problems: readonly string[]): void {
  if (problems.length === 0) return;
  throw new Error(
    "The public surface of @archwall/core changed.\n" +
      "If that is intentional, update the frozen list in this file and say so in the release " +
      "notes — removals are MAJOR. If it is not, the symbol probably belongs in " +
      "src/internal.ts.\nSee docs/adr/0018-public-and-internal-core-surface.md.\n  " +
      problems.join("\n  "),
  );
}

describe("public API surface of @archwall/core", () => {
  it("exports exactly the frozen set of values", async () => {
    const actual = Object.keys(await import("@archwall/core")).toSorted();
    assertNoDrift(diffSymbols("value", actual, PUBLIC_VALUES));
  });

  it("exports exactly the frozen set of types", () => {
    const surface = readBarrelSurface(CORE_BARREL);
    // A star re-export would make the frozen list unenforceable: the barrel would stop naming
    // what it exports, and this test would pass while the surface changed underneath it.
    expect(surface.starReexports).toEqual([]);
    assertNoDrift(diffSymbols("type", surface.types, PUBLIC_TYPES));
  });

  /**
   * Catches the mis-tagging neither list can see alone. A class re-exported with
   * `export type` is absent from the runtime namespace and present in the type list, so each
   * list on its own looks consistent — comparing the two derivations of one barrel is what
   * makes either trustworthy.
   */
  it("declares values as values and types as types", async () => {
    const surface = readBarrelSurface(CORE_BARREL);
    const runtime = Object.keys(await import("@archwall/core")).toSorted();
    const runtimeSet = new Set(runtime);
    const declared = new Set([...surface.values, ...surface.types]);
    const problems: string[] = [];

    for (const name of surface.values.filter((n) => !runtimeSet.has(n))) {
      problems.push(`${name}: exported with \`export\` but absent at runtime — it is a type`);
    }
    for (const name of surface.types.filter((n) => runtimeSet.has(n))) {
      problems.push(
        `${name}: exported with \`export type\` but present at runtime — it is a value, ` +
          "and consumers can neither call nor construct it",
      );
    }
    for (const name of runtime.filter((n) => !declared.has(n))) {
      problems.push(`${name}: exists at runtime but is not declared in src/index.ts`);
    }
    assertNoDrift(problems);
  });

  it("keeps the public value count under the ADR-0018 ceiling", async () => {
    const count = Object.keys(await import("@archwall/core")).length;
    expect(
      count,
      `@archwall/core exports ${count} public values; the ceiling is ${MAX_PUBLIC_VALUES}. ` +
        "Move engine mechanics into src/internal.ts rather than raising it.",
    ).toBeLessThan(MAX_PUBLIC_VALUES);
  });

  /**
   * The two barrels partition the surface. A symbol in both is not extra safety — the public
   * barrel freezes it regardless, and the frozen list would still pass.
   */
  it("shares no symbol between the public and internal barrels", () => {
    const publicSurface = readBarrelSurface(CORE_BARREL);
    const internalSurface = readBarrelSurface(INTERNAL_BARREL);
    const publicNames = new Set([...publicSurface.values, ...publicSurface.types]);
    const overlap = [...internalSurface.values, ...internalSurface.types]
      .filter((name) => publicNames.has(name))
      .toSorted();
    expect(
      overlap,
      `Exported from both src/index.ts and src/internal.ts: ${overlap.join(", ")}. Pick one — ` +
        "a symbol in the public barrel is frozen no matter what the internal one says.",
    ).toEqual([]);
  });
});
