export type {
  AnalysisResult,
  Capability,
  Diagnostic,
  Edge,
  EdgeKind,
  GraphDelivery,
  GraphMutation,
  GraphTransform,
  HostInfo,
  ModuleId,
  ModuleKind,
  ModuleNode,
  OutputDestination,
  OutputSink,
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
  ViolationLocation,
  WellKnownCapability,
} from "@archwall/core";
/**
 * The slice of `@archwall/core` an ADAPTER needs, re-exported explicitly.
 *
 * Explicitly, never `export *`: a re-export of everything would give each core symbol two
 * import paths, make core's entire surface into this package's public API, and produce
 * duplicate type identities under version skew.
 *
 * The list is deliberately short. An adapter builds a graph, starts a run, and formats
 * violations — it does not need rule authoring, classifiers, or the engine. Anything absent
 * is still available from `@archwall/core`, which is the honest import path for it.
 */
export {
  defineTransform,
  dropSelfEdges,
  formatViolation,
  primaryEdge,
  primaryModule,
} from "@archwall/core";
export type {
  ExpectedViolationAt,
  GraphSnapshot,
  GraphSnapshotOptions,
  ReadableGraph,
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
export { loadConfig, materializeConfig } from "./load-config.js";
export type {
  InferredModule,
  ModuleFacts,
  ModuleKindResolver,
} from "./module-kind.js";
export { createModuleKindResolver } from "./module-kind.js";
export { packageNameFromPath } from "./module-path.js";
export { nodeIO } from "./node-io.js";
export type { ArchWallRun, CreateRunOptions, RunResult } from "./run.js";
export { createArchWallRun, summarize } from "./run.js";
export { barePackageName, isBuiltinSpecifier } from "./specifiers.js";
