/**
 * One export per rule. Each is a `CallableRule`: pass it directly where a `Rule` is
 * wanted, or call it to configure an instance —
 * `noCycles({ maxCycleLength: 6 }, { severity: "warn" })`.
 */

export { DOCS_BASE, docsUrlFor } from "./docs.js";
export type { FeatureIsolationOptions } from "./feature-isolation.js";
export { featureIsolation } from "./feature-isolation.js";
export type {
  ForbiddenDependenciesOptions,
  ForbiddenDependencyEntry,
} from "./forbidden-dependencies.js";
export { forbiddenDependencies } from "./forbidden-dependencies.js";
export type { FriendModulesOptions } from "./friend-modules.js";
export { friendModules } from "./friend-modules.js";
export type { LayerDependenciesOptions } from "./layer-dependencies.js";
export { layerDependencies } from "./layer-dependencies.js";
export type { ModuleMatcher } from "./matchers.js";
export { moduleMatches, specifierMatches } from "./matchers.js";
export type { NoCyclesOptions } from "./no-cycles.js";
export { noCycles } from "./no-cycles.js";
export type { NoDeepImportsOptions } from "./no-deep-imports.js";
export { noDeepImports } from "./no-deep-imports.js";
export type { PublicApiOptions } from "./public-api.js";
export { publicApi } from "./public-api.js";
export type { RequireTagOptions } from "./require-tag.js";
export { requireTag } from "./require-tag.js";
