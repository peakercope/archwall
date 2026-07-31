/**
 * Everything public from core, wholesale.
 *
 * A hand-picked subset is how this package stopped being "the only one most users import":
 * anyone needing one type that was not on the list added `@archwall/core` alongside, and the
 * config file ended up with two import paths for one tool. It also mis-tagged `ProjectGraph`
 * and `GraphQuery` — both classes — as `export type`, so `new ProjectGraph(...)` failed for
 * umbrella users while looking perfectly correct in the source.
 *
 * A star re-export cannot drift, which makes completeness an ongoing property rather than a
 * reconciliation someone has to remember. `@archwall/core/internal` is deliberately absent:
 * this is the stable package, and nothing unstable reaches users through it.
 *
 * See docs/adr/0018-public-and-internal-core-surface.md.
 */
export * from "@archwall/core";
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
