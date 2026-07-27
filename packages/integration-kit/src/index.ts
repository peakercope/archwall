export type {
  AnalysisResult,
  Capability,
  Diagnostic,
  Edge,
  EdgeKind,
  GraphDelivery,
  GraphTransform,
  HostInfo,
  ModuleId,
  ModuleKind,
  ModuleNode,
  // Graph IR — what an adapter produces.
  ProjectGraph,
  Reporter,
  ReporterIO,
  ResolvedConfig,
  Severity,
  SourceLocation,
  // Configuration and results — what an adapter passes through and reports.
  UserConfig,
  Violation,
  WellKnownCapability,
} from "@archwall/core";
/**
 * The slice of `@archwall/core` an ADAPTER needs, re-exported explicitly.
 *
 * This was `export * from "@archwall/core"`, which had three consequences worth avoiding:
 * every core symbol gained two import paths; core's entire surface silently became
 * integration-kit's public API, so core could not evolve independently; and version skew
 * between the two packages produced duplicate type identities for the same nominal type.
 *
 * The list is deliberately short. An adapter builds a graph, starts a run, and formats
 * violations — it does not need rule authoring, classifiers, or the engine. Anything not
 * here is still available from `@archwall/core` directly, which is the honest import path
 * for it.
 */
export {
  defaultIO,
  defineTransform,
  dropSelfEdges,
  formatViolation,
} from "@archwall/core";
export type {
  ExpectedViolationAt,
  GraphSnapshot,
  GraphSnapshotOptions,
} from "./conformance.js";
export {
  assertGraphsMatch,
  assertViolationsMatch,
  FSD_APP_EXPECTED,
  graphSnapshot,
  LAYERED_APP_EXPECTED,
  MODULES_APP_EXPECTED,
} from "./conformance.js";
export type {
  AddEdgeInput,
  AddModuleInput,
  GraphBuilderOptions,
} from "./graph-builder.js";
export { GraphBuilder } from "./graph-builder.js";
export type { LoadConfigOptions } from "./load-config.js";
export { loadConfig } from "./load-config.js";
export type {
  InferredModule,
  ModuleFacts,
  ModuleKindResolver,
} from "./module-kind.js";
export { createModuleKindResolver } from "./module-kind.js";
export { packageNameFromPath } from "./module-path.js";
export type { ArchWallRun, CreateRunOptions, RunResult } from "./run.js";
export { createArchWallRun } from "./run.js";
export { barePackageName, isBuiltinSpecifier } from "./specifiers.js";
