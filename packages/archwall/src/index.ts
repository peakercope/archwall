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
 * The umbrella claims 95% of users touch only this package, and yet the README's own
 * second example imported `defineConfig` from `archwall` and `noCycles` from
 * `@archwall/rules` in adjacent lines. Either the claim or the surface was wrong; the
 * surface was.
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
