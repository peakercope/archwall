/**
 * The public, frozen surface of `@archwall/core`. Adding a name here is a minor release;
 * removing one is a major. Engine mechanics belong in `./internal.ts`, which carries no
 * guarantee — see docs/adr/0018-public-and-internal-core-surface.md.
 *
 * `test/public-surface.test.ts` holds both halves to their frozen lists.
 */

export { stronglyConnectedComponents } from "./analysis/scc.js";
export type { PathClassifierOptions, PathPattern } from "./classifiers/path.js";
export { pathClassifier } from "./classifiers/path.js";
export type {
  BuiltinReporterName,
  FailOn,
  FailOnDiagnostics,
  PresetSpec,
  ReporterOutputSpec,
  ReporterSpec,
  ResolvedConfig,
  ResolvedFailOnDiagnostics,
  ResolvedRule,
  RuleOverride,
  RuleSpec,
  UserConfig,
} from "./config.js";
export {
  DIAGNOSTIC_GATES,
  defineConfig,
  failingDiagnosticCodes,
  resolveConfig,
  resolveFailOnDiagnostics,
} from "./config.js";
export type { GraphComputation } from "./contracts/analysis.js";
export { defineGraphComputation } from "./contracts/analysis.js";
export type {
  Classifier,
  ClassifierContext,
  TagPatch,
} from "./contracts/classifier.js";
export { defineClassifier } from "./contracts/classifier.js";
export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
  EmptyScopeDetails,
  RuleSkippedDetails,
  WellKnownDiagnosticCode,
} from "./contracts/diagnostic.js";
export type { Preset, PresetMeta } from "./contracts/preset.js";
export { definePreset } from "./contracts/preset.js";
export type {
  AnalysisResult,
  AnalysisStats,
  OutputDestination,
  OutputSink,
  Reporter,
  ReporterIO,
  RuleRunInfo,
  RunInfo,
} from "./contracts/reporter.js";
export { defineReporter } from "./contracts/reporter.js";
export type {
  CallableRule,
  ConfiguredRule,
  Rule,
  RuleContext,
  RuleDeprecation,
  RuleMeta,
  RuleScope,
  RuleSettings,
  RuleVisitors,
} from "./contracts/rule.js";
export { configureRule, defineRule } from "./contracts/rule.js";
export type {
  StandardSchemaIssue,
  StandardSchemaResult,
  StandardSchemaV1,
} from "./contracts/standard-schema.js";
export type {
  GraphTransform,
  TransformContext,
} from "./contracts/transform.js";
export { defineTransform } from "./contracts/transform.js";
export { analyze } from "./engine/analyze.js";
export { ArchWallError, IrVersionMismatchError } from "./errors.js";
export type {
  Capability,
  Edge,
  EdgeKind,
  GraphDelivery,
  GraphMutation,
  HostInfo,
  ModuleId,
  ModuleIdScheme,
  ModuleKind,
  ModuleNode,
  ProjectGraphInit,
  SourceLocation,
  WellKnownCapability,
  WellKnownEdgeKind,
} from "./graph/ir.js";
export {
  assertIrCompatible,
  displayModuleId,
  FIRST_PARTY_KINDS,
  IR_VERSION,
  irMajor,
  isFirstParty,
  isThirdParty,
  MODULE_ID_SCHEMES,
  ProjectGraph,
  parseModuleId,
  THIRD_PARTY_KINDS,
} from "./graph/ir.js";
export type { EdgeFilter, ModuleFilter, ModuleSelection } from "./graph/query.js";
export { GraphQuery } from "./graph/query.js";
export { matchCaptures, matchesPattern } from "./match.js";
export {
  consoleReporter,
  defaultIO,
  formatViolation,
} from "./reporters/console.js";
export { jsonReporter } from "./reporters/json.js";
export type { ResolvedReporters } from "./reporters/resolve.js";
export {
  BUILTIN_REPORTER_NAMES,
  isBuiltinReporterName,
  resolveReporters,
} from "./reporters/resolve.js";
export { sarifReporter } from "./reporters/sarif.js";
export { dropSelfEdges } from "./transforms/drop-self-edges.js";
export type {
  Severity,
  SeverityCounts,
  Violation,
  ViolationInput,
  ViolationLocation,
} from "./violations.js";
export {
  compareViolations,
  countBySeverity,
  FINGERPRINT_SCHEME,
  fingerprintOf,
  locationsOf,
  primaryEdge,
  primaryModule,
  primarySourceLocation,
  renderMessage,
} from "./violations.js";
