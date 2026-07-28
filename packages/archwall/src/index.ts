export type {
  AnalysisResult,
  Capability,
  Classifier,
  ConfiguredRule,
  Edge,
  GraphComputation,
  GraphQuery,
  HostInfo,
  ModuleId,
  ModuleNode,
  PathClassifierOptions,
  PathPattern,
  Preset,
  ProjectGraph,
  Reporter,
  Rule,
  RuleContext,
  RuleOverride,
  Severity,
  UserConfig,
  Violation,
} from "@archwall/core";
export {
  configureRule,
  defineClassifier,
  defineConfig,
  defineGraphComputation,
  definePreset,
  defineReporter,
  defineRule,
  pathClassifier,
} from "@archwall/core";
export type {
  FsdOptions,
  LayeredOptions,
  LayerSpec,
  ModulesOptions,
} from "@archwall/presets";
// The built-in presets, so the common case is one import.
export { fsd, layered, modules } from "@archwall/presets";
export type {
  FeatureIsolationOptions,
  ForbiddenDependenciesOptions,
  ForbiddenDependencyEntry,
  FriendModulesOptions,
  LayerDependenciesOptions,
  ModuleMatcher,
  NoCyclesOptions,
  NoDeepImportsOptions,
  PublicApiOptions,
  RequireTagOptions,
} from "@archwall/rules";
/**
 * The built-in rules, for the very common case of adding one alongside a preset.
 *
 * This package is meant to be the only one most users import, so anything a config file
 * routinely reaches for belongs here — otherwise a single config ends up importing from
 * `archwall` and `@archwall/rules` in adjacent lines.
 */
export {
  featureIsolation,
  forbiddenDependencies,
  friendModules,
  layerDependencies,
  noCycles,
  noDeepImports,
  publicApi,
  requireTag,
} from "@archwall/rules";
